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
    has_voted: bool,
    current_vote: String,
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
    // Player registration/re-joining happens in register_player reducer called by client
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
    let spawn_position = Vector3 { x: (player_count as f32 * 5.0) - 2.5, y: 1.0, z: 0.0 };

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
        current_vote: String::new(),
        has_voted: false,
    }
}

#[spacetimedb::reducer]
pub fn create_room(ctx: &ReducerContext, room_name: String) -> Result<(), String> {
    // Check if room already exists
    if ctx.db.room().name().find(&room_name).is_some() {
        return Err(format!("Room '{}' already exists", room_name));
    }

    // Create the new room
    let new_room = Room {
        name: room_name,
        password: None,
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
    
    if let Some(mut room) =  ctx.db.room().name().find(&room_name) {
        // Check password
        if let Some(room_password) = &room.password {
            if room_password != &password {
                return Err("Incorrect password".to_string());
            }
        }
        // Check if room is full
        if room.current_player_count >= room.max_players {
            return Err("Room is full".to_string());
        }
        // Increment player count
        room.current_player_count += 1;
        ctx.db.room().name().update(room);
    } else {
        return Err(format!("Room '{}' does not exist", room_name));
    }

    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        // Player exists, update their room
        player.room_name = room_name.clone();
        player.current_vote = String::new();
        player.has_voted = false;
        ctx.db.player().identity().update(player);
        spacetimedb::log::info!("Player {} moved to room {}.", identity, room_name);
    } else {
        // Player doesn't exist - they need to register first!
        return Err("Please register before joining a room".to_string());
    }
    
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

    // Check if room exists (and create it if it doesn't)
    if !ctx.db.room().name().find(&room_name).is_some() {
        // Create the room if it doesn't exist
        let new_room = Room {
            name: room_name.clone(),
            password: None,
            max_players: MAX_PLAYERS_PER_ROOM,
            current_player_count: 0,
            created_at: ctx.timestamp,
            owner_identity: ctx.sender,
        };
        ctx.db.room().insert(new_room);
        spacetimedb::log::info!("Created new room: {}", room_name);
    }

    if ctx.db.player().identity().find(player_identity).is_some() {
        // If player already exists, just update their room
        let mut player = ctx.db.player().identity().find(player_identity).unwrap();
        player.room_name = room_name.clone();
        player.current_vote = String::new();
        player.has_voted = false;
        ctx.db.player().identity().update(player);
        spacetimedb::log::info!("Player {} moved to room {}.", player_identity, room_name);
        return Ok(());
    }

    if let Some(logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
        spacetimedb::log::info!("Player {} is rejoining in room {}.", player_identity, room_name);
        
        // Base initialization from the helper function
        let mut rejoining_player = initialize_player(
            ctx, 
            logged_out_player.identity,
            logged_out_player.username.clone(),
            logged_out_player.character_class.clone(),
            room_name
        );
        
        // Preserve some values from the logged out player
        rejoining_player.rotation = logged_out_player.rotation.clone();
        
        ctx.db.player().insert(rejoining_player);
        ctx.db.logged_out_player().identity().delete(player_identity);
    } else {
        spacetimedb::log::info!("Registering new player {} in room {}.", player_identity, room_name);
        
        // Use the helper function for new player initialization
        let new_player = initialize_player(
            ctx,
            player_identity,
            username,
            character_class,
            room_name
        );
        
        ctx.db.player().insert(new_player);
    }
    
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
pub fn game_tick(ctx: &ReducerContext, _tick_info: GameTickSchedule) {
    // Just use a simple log message without timestamp conversion
    let delta_time = 1.0; // Fixed 1-second tick for simplicity
    
    player_logic::update_players_logic(ctx, delta_time);
    
    spacetimedb::log::debug!("Game tick completed");
}

#[spacetimedb::reducer]
pub fn submit_vote(ctx: &ReducerContext, vote: String) -> Result<(), String> {
    let identity = ctx.sender;
    
    // Validate vote
    let valid_votes = vec!["S", "M", "L", "XL"];
    if !valid_votes.contains(&vote.as_str()) {
        return Err("Invalid vote. Must be one of: S, M, L, XL".to_string());
    }

    // Update player's vote
    if let Some(mut player) = ctx.db.player().identity().find(identity) {
        player.current_vote = vote;
        player.has_voted = true;
        ctx.db.player().identity().update(player);
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

#[spacetimedb::reducer]
pub fn reset_votes(ctx: &ReducerContext) -> Result<(), String> {
    // Reset all players' votes
    for player_id in ctx.db.player().iter().map(|p| p.identity).collect::<Vec<_>>() {
        if let Some(mut player) = ctx.db.player().identity().find(player_id) {
            player.current_vote = String::new();
            player.has_voted = false;
            ctx.db.player().identity().update(player);
        }
    }
    Ok(())
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
