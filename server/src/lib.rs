/**
 * Vibe Coding Starter Pack: 3D Multiplayer - lib.rs
 * 
 * Main entry point for the SpacetimeDB module. This file contains:
 * 
 * 1. Database Schema:
 *    - PlayerData: Active player information
 *    - LoggedOutPlayerData: Persistent data for disconnected players
 *    - GameTickSchedule: Periodic update scheduling
 * 
 * 2. Reducer Functions (Server Endpoints):
 *    - init: Module initialization and game tick scheduling
 *    - identity_connected/disconnected: Connection lifecycle management
 *    - register_player: Player registration with username and character class
 *    - update_player_input: Processes player movement and state updates
 *    - game_tick: Periodic update for game state (scheduled)
 * 
 * 3. Table Structure:
 *    - All tables use Identity as primary keys where appropriate
 *    - Connection between tables maintained through identity references
 * 
 * When modifying:
 *    - Table changes require regenerating TypeScript bindings
 *    - Add `public` tag to tables that need client access
 *    - New reducers should follow naming convention and error handling patterns
 *    - Game logic should be placed in separate modules (like player_logic.rs)
 *    - Extend game_tick for gameplay systems that need periodic updates
 * 
 * Related files:
 *    - common.rs: Shared data structures used in table definitions
 *    - player_logic.rs: Player movement and state update calculations
 */

// Declare modules
mod common;
mod player_logic;

use spacetimedb::{ReducerContext, Identity, Table, Timestamp, ScheduleAt};
use spacetimedb::{client_visibility_filter, Filter};
use std::time::Duration; // Import standard Duration

// Use items from common module (structs are needed for table definitions)
use crate::common::{Vector3, InputState,  MAX_PLAYERS_PER_ROOM};

// --- Filters & RLS ---


// A player can only see other players in the same room
#[client_visibility_filter]
const PLAYER_FILTER: Filter = Filter::Sql(
    "SELECT p.* FROM player p
     JOIN player viewer ON viewer.room_name = p.room_name
     WHERE viewer.identity = :sender"
);

// Players can see all available rooms
#[client_visibility_filter]
const ROOM_FILTER: Filter = Filter::Sql(
    "SELECT * FROM room"
);

// --- Schema Definitions ---

#[spacetimedb::table(name=room, public)]
#[derive(Clone)]
pub struct Room {
    #[primary_key]
    name: String,
    password: Option<String>,
    max_players: u32,
    current_player_count: u32,
    created_at: Timestamp,
    owner_identity: Identity,
}

#[spacetimedb::table(name = game_tile, public)]
#[derive(Clone)]
pub struct GameTile {
    #[primary_key]
    #[auto_inc]
    tile_id: u64,
    position: Vector3,
    size: Vector3,
}

#[derive(Clone, PartialEq, spacetimedb::SpacetimeType)]
pub enum VotingStatus {
    Pending,
    Completed,
}

#[spacetimedb::table(name = voting, public)]
#[derive(Clone)]
pub struct Voting {
    #[primary_key]
    #[auto_inc]
    voting_id: u64,
    #[index(btree)]
    room_name: String,
    status: VotingStatus,
    result: Option<String>,
    start_time: Timestamp,
    duration: u32,  // Duration in seconds
}

#[spacetimedb::table(name = vote, public)]
#[derive(Clone)]
pub struct Vote {
    #[primary_key]
    voting_id: u64,
    #[index(btree)]
    player_identity: Identity,
    vote_value: String,
}

#[spacetimedb::table(name = player, public)]
#[derive(Clone)]
pub struct PlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    current_animation: String,
    is_moving: bool,
    is_running: bool,
    is_attacking: bool,
    is_casting: bool,
    last_input_seq: u32,
    input: InputState,
    color: String,
    #[index(btree)]
    room_name: String,
}

#[spacetimedb::table(name = logged_out_player)]
#[derive(Clone)]
pub struct LoggedOutPlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    last_seen: Timestamp,
}

#[spacetimedb::table(name = game_tick_schedule, public, scheduled(game_tick))]
pub struct GameTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

// --- Lifecycle Reducers ---

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    spacetimedb::log::info!("[INIT] Initializing Vibe Multiplayer module...");
    if ctx.db.game_tick_schedule().count() == 0 {
        spacetimedb::log::info!("[INIT] Scheduling initial game tick (every 1 second)...");
        let loop_duration = Duration::from_secs(1);
        let schedule = GameTickSchedule {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(loop_duration.into()),
        };
        match ctx.db.game_tick_schedule().try_insert(schedule) {
            Ok(row) => spacetimedb::log::info!("[INIT] Game tick schedule inserted successfully. ID: {}", row.scheduled_id),
            Err(e) => spacetimedb::log::error!("[INIT] FAILED to insert game tick schedule: {}", e),
        }
    }

    // Initialize game tiles if none exist
    if ctx.db.game_tile().count() == 0 {
        spacetimedb::log::info!("[INIT] Creating initial game tiles...");
        
        let tiles = vec![
            (-20..=20).flat_map(|x| {
                (-20..=20).map(move |z| {
                    GameTile {
                        tile_id: 0,
                        position: Vector3 { x: x as f32 * 10.0, y: 0.0, z: z as f32 * 10.0 },
                        size: Vector3 { x: 10.0, y: 1.0, z: 10.0 },
                    }
                })
            }).collect::<Vec<_>>(),
        ].into_iter().flatten();

        for tile in tiles {
            if let Err(e) = ctx.db.game_tile().try_insert(tile) {
                spacetimedb::log::error!("[INIT] Failed to insert tile: {}", e);
            }
        }
        
        spacetimedb::log::info!("[INIT] Game tiles created successfully");
    }

    Ok(())
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    spacetimedb::log::info!("Client connected: {}", ctx.sender);
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!("Client disconnected: {}", player_identity);
    let logout_time: Timestamp = ctx.timestamp;

    if let Some(player) = ctx.db.player().identity().find(player_identity) {
        // Update room player count
        if let Some(mut room) = ctx.db.room().name().find(&player.room_name) {
            room.current_player_count = room.current_player_count.saturating_sub(1);
            ctx.db.room().name().update(room.clone());
            
            // If room is empty and not owned by this player, delete it
            if room.current_player_count == 0 && room.owner_identity != player_identity {
                ctx.db.room().name().delete(&room.name);
                spacetimedb::log::info!("Deleted empty room: {}", room.name);
            }
        }

        spacetimedb::log::info!("Moving player {} to logged_out_player table.", player_identity);
        let logged_out_player = LoggedOutPlayerData {
            identity: player.identity,
            username: player.username.clone(),
            character_class: player.character_class.clone(),
            position: player.position.clone(),
            rotation: player.rotation.clone(),
            last_seen: logout_time,
        };
        ctx.db.logged_out_player().insert(logged_out_player);
        ctx.db.player().identity().delete(player_identity);
    } else {
        spacetimedb::log::warn!("Disconnect by player {} not found in active player table.", player_identity);
        if let Some(mut logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
            logged_out_player.last_seen = logout_time;
            ctx.db.logged_out_player().identity().update(logged_out_player);
            spacetimedb::log::warn!("Updated last_seen for already logged out player {}.", player_identity);
        }
    }
}

// --- Game Specific Reducers ---

fn initialize_player(
    ctx: &ReducerContext, 
    identity: Identity, 
    username: String, 
    character_class: String,
    room_name: String
) -> PlayerData {
    // Assign color and position based on current player count
    let player_count = ctx.db.player().iter().count();
    let colors = ["cyan", "magenta", "yellow", "lightgreen", "white", "orange"];
    let assigned_color = colors[player_count % colors.len()].to_string();
    let spawn_position = Vector3 { x: 2.5, y: 1.0, z: 0.0 };

    let default_input = InputState {
        forward: false, backward: false, left: false, right: false,
        sprint: false, jump: false, attack: false, cast_spell: false,
        sequence: 0
    };

    PlayerData {
        identity,
        username,
        character_class,
        position: spawn_position,
        rotation: Vector3 { x: 0.0, y: 0.0, z: 0.0 },
        current_animation: "idle".to_string(),
        is_moving: false,
        is_running: false,
        is_attacking: false,
        is_casting: false,
        last_input_seq: 0,
        input: default_input,
        color: assigned_color,
        room_name,
    }
}

#[spacetimedb::reducer]
pub fn create_room(ctx: &ReducerContext, room_name: String, password: Option<String>) -> Result<(), String> {
    // Check if room already exists
    if ctx.db.room().name().find(&room_name).is_some() {
        return Err(format!("Room '{}' already exists", room_name));
    }

    // Create the new room
    let new_room = Room {
        name: room_name,
        password,
        max_players: MAX_PLAYERS_PER_ROOM,
        current_player_count: 0,
        created_at: ctx.timestamp,
        owner_identity: ctx.sender,
    };
    
    ctx.db.room().insert(new_room);
    Ok(())
}

#[spacetimedb::reducer]
pub fn join_room(ctx: &ReducerContext, room_name: String, password: String) -> Result<(), String> {
    let identity = ctx.sender;

    // Validate room and password first
    let mut room = ctx.db.room().name().find(&room_name)
        .ok_or_else(|| format!("Room '{}' does not exist", room_name))?;

    // Check password if set
    if let Some(ref stored_password) = room.password {
        if password.is_empty() || stored_password.as_str() != password.as_str() {
            return Err("Incorrect password".to_string());
        }
    }

    // Check if room is full
    if room.current_player_count >= room.max_players {
        return Err("Room is full".to_string());
    }

    // If player exists, handle room transition
    if let Some(player) = ctx.db.player().identity().find(identity) {
        // Check if already in this room
        if player.room_name == room_name {
            return Err("Already in this room".to_string());
        }

        // Leave current room first
        if let Some(mut old_room) = ctx.db.room().name().find(&player.room_name) {
            old_room.current_player_count = old_room.current_player_count.saturating_sub(1);
            ctx.db.room().name().update(old_room.clone());
            
            // Delete empty room if not owned by this player
            if old_room.current_player_count == 0 && old_room.owner_identity != identity {
                ctx.db.room().name().delete(&old_room.name);
                spacetimedb::log::info!("Deleted empty room: {}", old_room.name);
            }
        }

        // Update player's room
        let mut updated_player = player;
        updated_player.room_name = room_name.clone();
        ctx.db.player().identity().update(updated_player);
    }

    // Update new room count
    room.current_player_count += 1;
    ctx.db.room().name().update(room);
    
    spacetimedb::log::info!("Player {} joined room {}", identity, room_name);
    Ok(())
}

#[spacetimedb::reducer]
pub fn register_player(
    ctx: &ReducerContext, 
    username: String, 
    character_class: String,
    room_name: String
) -> Result<(), String> {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!(
        "Registering player {} ({}) with class {} in room {}",
        username,
        player_identity,
        character_class,
        room_name
    );

    // First, handle the room validation
    let mut room = if let Some(existing_room) = ctx.db.room().name().find(&room_name) {
        if existing_room.current_player_count >= existing_room.max_players {
            return Err("Room is full".to_string());
        }
        existing_room
    } else {
        // Create the room if it doesn't exist
        Room {
            name: room_name.clone(),
            password: None,
            max_players: MAX_PLAYERS_PER_ROOM,
            current_player_count: 0,
            created_at: ctx.timestamp,
            owner_identity: ctx.sender,
        }
    };

    // If player exists, handle room transition
    if let Some(existing_player) = ctx.db.player().identity().find(player_identity) {
        // If already in this room, just return success without changing anything
        if existing_player.room_name == room_name {
            return Ok(());
        }

        // Moving to a different room - decrease old room count
        if let Some(mut old_room) = ctx.db.room().name().find(&existing_player.room_name) {
            old_room.current_player_count = old_room.current_player_count.saturating_sub(1);
            ctx.db.room().name().update(old_room.clone());
            
            // Clean up empty old room if needed
            if old_room.current_player_count == 0 && old_room.owner_identity != player_identity {
                ctx.db.room().name().delete(&old_room.name);
                spacetimedb::log::info!("Deleted empty room: {}", old_room.name);
            }
        }
        
        // Update player's room
        let mut updated_player = existing_player;
        updated_player.room_name = room_name.clone();
        ctx.db.player().identity().update(updated_player);
        
        // Update new room's count
        room.current_player_count += 1;
        ctx.db.room().name().update(room);
        return Ok(());
    }

    // Handle new player or rejoining player
    let new_player = if let Some(logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
        spacetimedb::log::info!("Player {} is rejoining in room {}.", player_identity, room_name);
        let mut rejoining_player = initialize_player(
            ctx, 
            logged_out_player.identity,
            logged_out_player.username,
            logged_out_player.character_class,
            room_name.clone()
        );
        rejoining_player.rotation = logged_out_player.rotation;
        ctx.db.logged_out_player().identity().delete(player_identity);
        rejoining_player
    } else {
        initialize_player(ctx, player_identity, username, character_class, room_name.clone())
    };

    // Update or insert the room with incremented count
    room.current_player_count += 1;
    if ctx.db.room().name().find(&room_name).is_none() {
        ctx.db.room().insert(room);
    } else {
        ctx.db.room().name().update(room);
    }

    // Insert the player AFTER room is updated
    ctx.db.player().insert(new_player);
    spacetimedb::log::info!("Player {} registered in room {}", player_identity, room_name);
    
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_player_input(
    ctx: &ReducerContext,
    input: InputState,
    _client_pos: Vector3,
    client_rot: Vector3,
    client_animation: String,
) {
    if let Some(mut player) = ctx.db.player().identity().find(ctx.sender) {
        player_logic::update_input_state(&mut player, input, client_rot, client_animation);
        ctx.db.player().identity().update(player);
    } else {
        spacetimedb::log::warn!("Player {} tried to update input but is not active.", ctx.sender);
    }
}

#[spacetimedb::reducer(update)]
pub fn check_voting_completion(ctx: &ReducerContext) {
    spacetimedb::log::info!("[VOTING] Checking for completed votings...");
    
    // Find all pending votes
    let pending_votes: Vec<_> = ctx.db.voting()
        .iter()
        .filter(|v| v.status == VotingStatus::Pending)
        .collect();
    
    spacetimedb::log::info!("[VOTING] Found {} pending voting sessions", pending_votes.len());
    
    for mut voting in pending_votes {
        // Get raw timestamp values
        let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
        let start_micros = voting.start_time.to_micros_since_unix_epoch();
        
        // Calculate elapsed time with proper precision
        let elapsed_micros = now_micros.saturating_sub(start_micros);
        let elapsed_seconds_f64 = elapsed_micros as f64 / 1_000_000.0;
        let elapsed_seconds = (elapsed_micros / 1_000_000) as u32;
        
        // Detailed logs
        spacetimedb::log::info!(
            "[VOTING] ID: {}, Room: {}, Start: {:?}, Now: {:?}, Duration: {}s",
            voting.voting_id, voting.room_name, voting.start_time, ctx.timestamp, voting.duration
        );
        
        spacetimedb::log::info!(
            "[VOTING] Time details - Elapsed: {:.2}s (raw: {}s), Required: {}s, Difference: {:.2}s",
            elapsed_seconds_f64, elapsed_seconds, voting.duration, 
            elapsed_seconds_f64 - voting.duration as f64
        );
        
        // Check if voting should be completed
        if elapsed_seconds >= voting.duration {
            spacetimedb::log::info!(
                "[VOTING] Completing vote ID: {}, Room: {}, Elapsed: {:.2}s",
                voting.voting_id, voting.room_name, elapsed_seconds_f64
            );
            
            // Get all votes for this voting session
            let votes: Vec<_> = ctx.db.vote()
                .iter()
                .filter(|v| v.voting_id == voting.voting_id)
                .collect();
                
            spacetimedb::log::info!(
                "[VOTING] Found {} votes for ID {}",
                votes.len(),
                voting.voting_id
            );
            
            // Log individual votes for debugging
            for (i, v) in votes.iter().enumerate() {
                spacetimedb::log::info!(
                    "[VOTING] Vote {}: Player {} voted '{}'",
                    i + 1, v.player_identity, v.vote_value
                );
            }

            // Simple majority calculation
            let mut vote_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for vote in votes {
                *vote_counts.entry(vote.vote_value).or_insert(0) += 1;
            }

            // Log vote distribution
            for (value, count) in &vote_counts {
                spacetimedb::log::info!(
                    "[VOTING] Value '{}' received {} votes",
                    value, count
                );
            }
            
            let result = vote_counts
                .into_iter()
                .max_by_key(|&(_, count)| count)
                .map(|(value, count)| {
                    spacetimedb::log::info!(
                        "[VOTING] Winning value '{}' with {} votes",
                        value, count
                    );
                    value
                });

            // Update voting status
            voting.status = VotingStatus::Completed;
            voting.result = result;
            
            spacetimedb::log::info!(
                "[VOTING] Final result for ID {}: {:?}",
                voting.voting_id,
                voting.result
            );
            
            ctx.db.voting().voting_id().update(voting).unwrap_or_else(|e| {
                spacetimedb::log::error!(
                    "[VOTING] Failed to update voting {}: {:?}",
                    voting.voting_id, e
                );
            });
            
            spacetimedb::log::info!(
                "[VOTING] Successfully completed voting ID: {}",
                voting.voting_id
            );
        }
    }
    
    spacetimedb::log::info!("[VOTING] Completion check finished");
}

#[spacetimedb::reducer]
pub fn configure_room(
    ctx: &ReducerContext,
    room_name: String,
    new_password: Option<String>,
    new_max_players: Option<u32>
) -> Result<(), String> {
    let identity = ctx.sender;
    
    if let Some(mut room) = ctx.db.room().name().find(&room_name) {
        // Only room owner can configure the room
        if room.owner_identity != identity {
            return Err("Only the room owner can modify room settings".to_string());
        }

        // Update password if provided
        if let Some(password) = new_password {
            room.password = if password.is_empty() { None } else { Some(password) };
        }

        // Update max players if provided (ensure it's not less than current count)
        if let Some(max_players) = new_max_players {
            if max_players < room.current_player_count {
                return Err("Cannot set max players lower than current player count".to_string());
            }
            room.max_players = max_players;
        }

        ctx.db.room().name().update(room);
        Ok(())
    } else {
        Err(format!("Room '{}' does not exist", room_name))
    }
}

#[spacetimedb::reducer]
pub fn leave_room(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender;
    
    if let Some(player) = ctx.db.player().identity().find(identity) {
        let room_name = player.room_name.clone();
        
        // Update room player count
        if let Some(mut room) = ctx.db.room().name().find(&room_name) {
            room.current_player_count = room.current_player_count.saturating_sub(1);
            ctx.db.room().name().update(room.clone());
            
            // If room is empty and not owned by this player, delete it
            if room.current_player_count == 0 && room.owner_identity != identity {
                ctx.db.room().name().delete(&room_name);
                spacetimedb::log::info!("Deleted empty room: {}", room_name);
            }
        }

        // Remove player from the game
        ctx.db.player().identity().delete(identity);
        spacetimedb::log::info!("Player {} left room {}", identity, room_name);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

#[spacetimedb::reducer]
pub fn start_voting(ctx: &ReducerContext, room_name: String) -> Result<(), String> {
    // Create a new voting with a 10-second duration
    let new_voting = Voting {
        voting_id: generate_uuid(), // Or however you generate IDs
        room_name,
        start_time: ctx.timestamp,
        duration: 10, // Make sure this is set to 10 seconds
        status: VotingStatus::Pending,
        result: None,
    };
    
    spacetimedb::log::info!(
        "[VOTING] Starting new vote - Room: {}, Duration: {}s, Time: {}",
        room_name, new_voting.duration, ctx.timestamp
    );
    
    ctx.db.voting().insert(new_voting);
    Ok(())
}