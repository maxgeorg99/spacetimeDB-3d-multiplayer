/**
 * Vibe Coding Starter Pack: 3D Multiplayer - App.tsx
 * 
 * Main application component that orchestrates the entire multiplayer experience.
 * This file serves as the central hub for:
 * 
 * 1. SpacetimeDB Connection Management:
 *    - Establishes and maintains WebSocket connection
 *    - Handles authentication and identity
 *    - Subscribes to database tables
 *    - Processes real-time updates
 * 
 * 2. Player Input Handling:
 *    - Keyboard and mouse event listeners
 *    - Input state tracking and normalization
 *    - Animation state determination
 *    - Camera/rotation management with pointer lock
 * 
 * 3. Game Loop:
 *    - Sends player input to server at appropriate intervals
 *    - Updates local state based on server responses
 *    - Manages the requestAnimationFrame cycle
 * 
 * 4. UI Management:
 *    - Renders GameScene (3D view)
 *    - Controls DebugPanel visibility
 *    - Manages JoinGameDialog for player registration
 *    - Displays connection status
 * 
 * Extension points:
 *    - Add new input types in currentInputRef and InputState
 *    - Extend determineAnimation for new animation states
 *    - Add new reducers calls for game features (see handleCastSpellInput)
 *    - Modify game loop timing or prediction logic
 * 
 * Related files:
 *    - components/GameScene.tsx: 3D rendering with Three.js
 *    - components/Player.tsx: Character model and animation
 *    - components/DebugPanel.tsx: Developer tools and state inspection
 *    - generated/: Auto-generated TypeScript bindings from the server
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import './App.css';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import * as moduleBindings from './generated';
import { DebugPanel } from './components/DebugPanel';
import { GameScene } from './components/GameScene';
import { JoinGameDialog } from './components/JoinGameDialog';
import * as THREE from 'three';
// Remove unused import
// import { PlayerUI } from './components/PlayerUI';
import { VotingPanel } from './components/VotingPanel';
import { MainMenu } from './components/MainMenu';
import { VotingStatus } from './generated/voting_status_type';

// Type Aliases
type DbConnection = moduleBindings.DbConnection;
type EventContext = moduleBindings.EventContext;
type ErrorContext = moduleBindings.ErrorContext;
type PlayerData = moduleBindings.PlayerData;
type InputState = moduleBindings.InputState;
type GameTile = moduleBindings.GameTile;
type Room = moduleBindings.Room;
type Vote = moduleBindings.Vote;
type Voting = moduleBindings.Voting;
// ... other types ...

let conn: DbConnection | null = null;

function App() {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [players, setPlayers] = useState<ReadonlyMap<string, PlayerData>>(new Map());
  const [tiles, setTiles] = useState<ReadonlyMap<string, GameTile>>(new Map());
  const [localPlayer, setLocalPlayer] = useState<PlayerData | null>(null);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [isDebugPanelExpanded, setIsDebugPanelExpanded] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false); // State for pointer lock status
  const [showMainMenu, setShowMainMenu] = useState(true);
  const [rooms, setRooms] = useState<ReadonlyMap<string, Room>>(new Map());
  const [selectedRoomName, setSelectedRoomName] = useState<string>("");
  const [votes, setVotes] = useState<ReadonlyMap<string, Vote>>(new Map());
  const [votings, setVotings] = useState<ReadonlyMap<string, Voting>>(new Map());
  const [timeRemaining, setTimeRemaining] = useState(10);

  // --- Ref for current input state ---
  const currentInputRef = useRef<InputState>({
    forward: false, backward: false, left: false, right: false,
    sprint: false, jump: false, attack: false, castSpell: false,
    sequence: 0,
  });
  const lastSentInputState = useRef<Partial<InputState>>({});
  const animationFrameIdRef = useRef<number | null>(null); // For game loop

  // New import for handling player rotation data
  const playerRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ'));

  // --- Moved Table Callbacks/Subscription Functions Up ---
  const registerTableCallbacks = useCallback((activeIdentity: Identity) => {
    if (!conn) return;
    console.log("Registering table callbacks...");
    
    conn.db.gameTile.onInsert((_ctx: EventContext, tile: GameTile) => {
        console.log("Tile inserted (callback):", tile.tileId);
        setTiles((prev: ReadonlyMap<string, GameTile>) => new Map(prev).set(tile.tileId.toString(), tile));
    });

    conn.db.player.onInsert((_ctx: EventContext, player: PlayerData) => {
        console.log("Player inserted (callback):", player.identity.toHexString(), "identity:", activeIdentity.toHexString());
        setPlayers((prev: ReadonlyMap<string, PlayerData>) => new Map(prev).set(player.identity.toHexString(), player));
        if (player.identity.toHexString() === activeIdentity.toHexString()) {
            console.log("Local player registered:", player.identity.toHexString());
            setLocalPlayer(player);
            setStatusMessage(`Registered as ${player.username}`);
        }
    });

    conn.db.player.onUpdate((_ctx: EventContext, _oldPlayer: PlayerData, newPlayer: PlayerData) => {
        setPlayers((prev: ReadonlyMap<string, PlayerData>) => {
            const newMap = new Map(prev);
            newMap.set(newPlayer.identity.toHexString(), newPlayer);
            return newMap;
        });
        if (newPlayer.identity.toHexString() === activeIdentity.toHexString()) {
            setLocalPlayer(newPlayer);
        }
    });

    conn.db.player.onDelete((_ctx: EventContext, player: PlayerData) => {
        console.log("Player deleted (callback):", player.identity.toHexString());
        setPlayers((prev: ReadonlyMap<string, PlayerData>) => {
            const newMap = new Map(prev);
            newMap.delete(player.identity.toHexString());
            return newMap;
        });
        if (player.identity.toHexString() === activeIdentity.toHexString()) {
            setLocalPlayer(null);
            setStatusMessage("Local player deleted!");
        }
    });

    // Add room table callbacks
    conn.db.room.onInsert((_ctx: EventContext, room: Room) => {
      console.log("Room inserted:", room.name);
      setRooms((prev: ReadonlyMap<string, Room>) => new Map(prev).set(room.name, room));
    });

    conn.db.room.onUpdate((_ctx: EventContext, _oldRoom: Room, newRoom: Room) => {
      setRooms((prev: ReadonlyMap<string, Room>) => new Map(prev).set(newRoom.name, newRoom));
    });

    conn.db.room.onDelete((_ctx: EventContext, room: Room) => {
      setRooms((prev: ReadonlyMap<string, Room>) => {
        const newMap = new Map(prev);
        newMap.delete(room.name);
        return newMap;
      });
    });

    // Register voting table callbacks
    conn.db.voting.onInsert((_ctx: EventContext, voting: Voting) => {
      console.log("[Voting] New voting session:", voting);
      setVotings((prev: ReadonlyMap<string, Voting>) => new Map(prev).set(voting.votingId.toString(), voting));
    });

    conn.db.voting.onUpdate((_ctx: EventContext, _oldVoting: Voting, newVoting: Voting) => {
      console.log("[Voting] Voting updated:", newVoting);
      setVotings((prev: ReadonlyMap<string, Voting>) => new Map(prev).set(newVoting.votingId.toString(), newVoting));
    });

    conn.db.voting.onDelete((_ctx: EventContext, voting: Voting) => {
      console.log("[Voting] Voting deleted:", voting);
      setVotings((prev: ReadonlyMap<string, Voting>) => {
        const newMap = new Map(prev);
        newMap.delete(voting.votingId.toString());
        return newMap;
      });
    });

    // Register vote table callbacks
    conn.db.vote.onInsert((_ctx: EventContext, vote: Vote) => {
      console.log("[Vote] New vote:", vote);
      setVotes((prev: ReadonlyMap<string, Vote>) => 
        new Map(prev).set(`${vote.votingId}-${vote.playerIdentity.toHexString()}`, vote)
      );
    });

    conn.db.vote.onDelete((_ctx: EventContext, vote: Vote) => {
      console.log("[Vote] Vote deleted:", vote);
      setVotes((prev: ReadonlyMap<string, Vote>) => {
        const newMap = new Map(prev);
        newMap.delete(`${vote.votingId}-${vote.playerIdentity.toHexString()}`);
        return newMap;
      });
    });

    console.log("Table callbacks registered.");
  }, [identity]); // Keep identity dependency

  const onSubscriptionApplied = useCallback(() => {
    console.log("Subscription applied successfully.");
    if (!conn) return;

    // Initialize all tables from current state
    const currentPlayers = new Map<string, PlayerData>();
    for (const player of conn.db.player.iter()) {
      currentPlayers.set(player.identity.toHexString(), player);
      if (identity && player.identity.toHexString() === identity.toHexString()) {
        setLocalPlayer(player);
      }
    }
    setPlayers(currentPlayers);

    // Initialize rooms
    const currentRooms = new Map<string, Room>();
    for (const room of conn.db.room.iter()) {
      currentRooms.set(room.name, room);
    }
    setRooms(currentRooms);

    // Initialize votings
    const currentVotings = new Map<string, Voting>();
    for (const voting of conn.db.voting.iter()) {
      currentVotings.set(voting.votingId.toString(), voting);
    }
    setVotings(currentVotings);

    // Initialize votes
    const currentVotes = new Map<string, Vote>();
    for (const vote of conn.db.vote.iter()) {
      currentVotes.set(`${vote.votingId}-${vote.playerIdentity.toHexString()}`, vote);
    }
    setVotes(currentVotes);

    console.log("Initial state loaded from subscription");
  }, [conn, identity]);

  const onSubscriptionError = useCallback((error: any) => {
      console.error("Subscription error:", error);
      setStatusMessage(`Subscription Error: ${error?.message || error}`);
  }, []);

  const subscribeToTables = useCallback(() => {
    if (!conn) return;
    console.log("Subscribing to tables...");
    const subscription = conn.subscriptionBuilder();
    subscription.subscribe("SELECT * FROM player");
    subscription.subscribe("SELECT * FROM room");
    subscription.subscribe("SELECT * FROM voting");
    subscription.subscribe("SELECT * FROM vote");
    subscription.onApplied(onSubscriptionApplied);
    subscription.onError(onSubscriptionError);
  }, [identity, onSubscriptionApplied, onSubscriptionError]); // Add dependencies

  // --- Event Handlers ---
  const handleDelegatedClick = useCallback((event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest('.interactive-button');
      if (button) {
          event.preventDefault();
          console.log(`[CLIENT] Button click detected: ${button.getAttribute('data-action')}`);
          // Generic button handler without specific attack functionality
      }
  }, []);

  // --- Input State Management ---
  const keyMap: { [key: string]: keyof Omit<InputState, 'sequence' | 'castSpell'> } = {
      KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
      ShiftLeft: 'sprint', Space: 'jump',
  };

  const determineAnimation = useCallback((input: InputState): string => {
    if (input.attack) return 'attack1';
    if (input.castSpell) return 'cast';
    if (input.jump) return 'jump';
    
    // Determine animation based on movement keys
    const { forward, backward, left, right, sprint } = input;
    const isMoving = forward || backward || left || right;
    
    if (!isMoving) return 'idle';
    
    // Improved direction determination with priority handling
    // This matches legacy implementation better
    let direction = 'forward';
    
    // Primary direction determination - match legacy player.js logic
    if (forward && !backward) {
      direction = 'forward';
    } else if (backward && !forward) {
      direction = 'back';
    } else if (left && !right) {
      direction = 'left';
    } else if (right && !left) {
      direction = 'right';
    } else if (forward && left) {
      // Handle diagonal movement by choosing dominant direction
      direction = 'left';
    } else if (forward && right) {
      direction = 'right'; 
    } else if (backward && left) {
      direction = 'left';
    } else if (backward && right) {
      direction = 'right';
    }
    
    // Choose movement type based on sprint state
    const moveType = sprint ? 'run' : 'walk';
    
    // Generate final animation name
    const animationName = `${moveType}-${direction}`;
    
    return animationName;
  }, []);

  const sendInput = useCallback((currentInputState: InputState) => {
    if (!conn || !identity || !connected || !localPlayer || !localPlayer?.roomName) return;
    const currentPosition = localPlayer?.position || { x: 0, y: 0, z: 0 };
    
    // Now using the playerRotationRef for more accurate rotation tracking
    const currentRotation = {
      x: playerRotationRef.current.x,
      y: playerRotationRef.current.y,
      z: playerRotationRef.current.z
    };
    
    // Determine animation from input state
    const currentAnimation = determineAnimation(currentInputState);

    let changed = false;
    for (const key in currentInputState) {
        if (currentInputState[key as keyof InputState] !== lastSentInputState.current[key as keyof InputState]) {
            changed = true;
            break;
        }
    }

    if (changed || currentInputState.sequence !== lastSentInputState.current.sequence) {
        conn.reducers.updatePlayerInput(currentInputState, currentPosition, currentRotation, currentAnimation);
        lastSentInputState.current = { ...currentInputState };
    }
  }, [identity, localPlayer, connected, determineAnimation]);

  // Add player rotation handler
  const handlePlayerRotation = useCallback((rotation: THREE.Euler) => {
    // Update our stored rotation whenever the player rotates (from mouse movements)
    playerRotationRef.current.copy(rotation);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
      if (event.repeat) return; 
      const action = keyMap[event.code];
      if (action) {
          if (!currentInputRef.current[action]) { 
             currentInputRef.current[action] = true;
          }
      }
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
      const action = keyMap[event.code];
      if (action) {
          if (currentInputRef.current[action]) { 
              currentInputRef.current[action] = false;
          }
      }
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
      if (event.button === 0) { 
           if (!currentInputRef.current.attack) {
               currentInputRef.current.attack = true;
           }
      }
  }, []);

  const handleMouseUp = useCallback((event: MouseEvent) => {
      if (event.button === 0) { 
           if (currentInputRef.current.attack) {
               currentInputRef.current.attack = false;
           }
      }
  }, []);

  // Add mouse move handler with pointer lock for rotation
  const handleMouseMove = useCallback((event: MouseEvent) => {
    // Only rotate if we have pointer lock
    if (document.pointerLockElement === document.body) {
      const sensitivity = 0.002;
      // Update the Euler rotation with mouse movement
      playerRotationRef.current.y -= event.movementX * sensitivity;
      
      // Clamp vertical rotation (looking up/down) to prevent flipping
      playerRotationRef.current.x = Math.max(
        -Math.PI / 2.5, 
        Math.min(Math.PI / 2.5, playerRotationRef.current.x - event.movementY * sensitivity)
      );
    }
  }, []);

  // --- Listener Setup/Removal Functions ---
  const handlePointerLockChange = useCallback(() => {
    setIsPointerLocked(document.pointerLockElement === document.body);
    console.log("Pointer Lock Changed: ", document.pointerLockElement === document.body);
  }, []);

  const setupInputListeners = useCallback(() => {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove); // Add mouse move listener
      document.addEventListener('pointerlockchange', handlePointerLockChange); // Listen for lock changes
      console.log("Input listeners added.");
  }, [handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handleMouseMove, handlePointerLockChange]);

  const removeInputListeners = useCallback(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove); // Remove mouse move listener
      document.removeEventListener('pointerlockchange', handlePointerLockChange); // Remove listener
      console.log("Input listeners removed.");
  }, [handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handleMouseMove, handlePointerLockChange]);

  const setupDelegatedListeners = useCallback(() => {
      document.body.addEventListener('click', handleDelegatedClick, true);
      console.log("Delegated listener added to body.");
  }, [handleDelegatedClick]);

  const removeDelegatedListeners = useCallback(() => {
      document.body.removeEventListener('click', handleDelegatedClick, true);
      console.log("Delegated listener removed from body.");
  }, [handleDelegatedClick]);

  // --- Game Loop Effect ---
  useEffect(() => {
      const gameLoop = () => {
          if (!connected || !conn || !identity) {
              if (animationFrameIdRef.current) {
                  cancelAnimationFrame(animationFrameIdRef.current);
                  animationFrameIdRef.current = null;
              }
              return;
          }

          // Handle voting time updates
          if (votings.size > 0) {
              const currentVotings = Array.from(votings.values());
              for (const voting of currentVotings) {
                  if (voting.status === VotingStatus.Pending) {
                      const now = Date.now();
                      const elapsedSeconds = Math.floor((now / 1000) - Number(voting.startTime.microsSinceUnixEpoch) / 1_000_000);
                      const remaining = Math.max(0, voting.duration - elapsedSeconds);
                      setTimeRemaining(remaining);
                  }
              }
          }

          // Regular game loop updates
          currentInputRef.current.sequence += 1;
          sendInput(currentInputRef.current);
          animationFrameIdRef.current = requestAnimationFrame(gameLoop);
      };

      if (connected && !animationFrameIdRef.current) {
          console.log("[CLIENT] Starting game loop.");
          animationFrameIdRef.current = requestAnimationFrame(gameLoop);
      }

      return () => {
          if (animationFrameIdRef.current) {
              console.log("[CLIENT] Stopping game loop.");
              cancelAnimationFrame(animationFrameIdRef.current);
              animationFrameIdRef.current = null;
          }
      };
  }, [connected, conn, identity, sendInput, votings]);

  // --- Connection Effect Hook ---
  useEffect(() => {
    console.log("Running Connection Effect Hook...");
    if (conn) {
        console.log("Connection already established, skipping setup.");
         if (connected) {
             setupInputListeners();
             setupDelegatedListeners();
         }
        return;
    }

    const dbHost = "localhost:3000";
    const dbName = "vibe-multiplayer";

    console.log(`Connecting to SpacetimeDB at ${dbHost}, database: ${dbName}...`);

    const onConnect = (connection: DbConnection, id: Identity, _token: string) => {
      console.log("Connected!");
      conn = connection;
      setIdentity(id);
      setConnected(true);
      setStatusMessage(`Connected as ${id.toHexString().substring(0, 8)}...`);
      subscribeToTables();
      registerTableCallbacks(id);
      setupInputListeners();
      setupDelegatedListeners();
      setShowMainMenu(true);
    };

    const onDisconnect = (_ctx: ErrorContext, reason?: Error | null) => {
      const reasonStr = reason ? reason.message : "No reason given";
      console.log("onDisconnect triggered:", reasonStr);
      setStatusMessage(`Disconnected: ${reasonStr}`);
      conn = null;
      setIdentity(null);
      setConnected(false);
      setPlayers(new Map());
      setLocalPlayer(null);
    };

    // Build connection with WebSocket compression disabled
    moduleBindings.DbConnection.builder()
      .withUri(`ws://${dbHost}`)
      .withModuleName(dbName)
      .withCompression('none') // Disable WebSocket compression
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .build();

    return () => {
      console.log("Cleaning up connection effect - removing listeners.");
      removeInputListeners();
      removeDelegatedListeners();
    };
  }, []);

  // --- handleJoinGame ---
  const handleJoinGame = async (username: string, characterClass: string) => {
    if (!conn) {
      console.error("Cannot join game, not connected.");
      return;
    }
    if (!selectedRoomName) {
      console.error("No room selected.");
      return;
    }
    try {      
      console.log(`Registering as ${username} (${characterClass}) in room ${selectedRoomName}...`);
      conn.reducers.registerPlayer(username, characterClass, selectedRoomName);
      
      setLocalPlayer(null); // Reset local player to force re-fetch
      setShowJoinDialog(false);
    } catch (error) {
      console.error("Failed to register player:", error);
      setStatusMessage(`Failed to register: ${error}`);
      setShowMainMenu(true);
      setShowJoinDialog(false);
    }
  };

  // Room management handlers
  const handleCreateRoom = useCallback((roomName: string, password?: string) => {
    if (!conn) return;
    try {
      conn.reducers.createRoom(roomName, password);
      setSelectedRoomName(roomName); // Store the room name when creating
      setShowMainMenu(false);
      setShowJoinDialog(true); // Show join dialog after creating room
    } catch (error) {
      console.error("Failed to create room:", error);
      setStatusMessage(`Failed to create room: ${error}`);
    }
  }, [conn]);

  const handleJoinRoom = useCallback(async (roomName: string, password?: string) => {
    if (!conn) return;
    try {
      // First try to join the room
      await conn.reducers.joinRoom(roomName, password || "");
      
      // If join successful, store room name and show registration dialog
      setSelectedRoomName(roomName);
      setShowMainMenu(false);
      setShowJoinDialog(true);
    } catch (error) {
      console.error("Failed to join room:", error);
      // Don't hide the main menu on error, let it show the error in the password dialog
      setStatusMessage(`Failed to join room: ${error}`);
      throw error; // Propagate error to MainMenu component
    }
  }, [conn]);

  // --- Render Logic ---
  return (
    <div className="App" style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {connected && showMainMenu && (
        <MainMenu 
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          availableRooms={Array.from(rooms.values()).map(room => ({
            id: room.name,
            name: room.name,
            playerCount: room.currentPlayerCount,
            maxPlayers: room.maxPlayers,
            hasPassword: !!room.password
          }))}
          isConnected={connected}
        />
      )}
      
      {showJoinDialog && !showMainMenu && <JoinGameDialog onJoin={handleJoinGame} />}
      

      {/* Render GameScene and PlayerUI only when connected */}

      {/* Always render GameScene when connected */} 
      {connected && (
        <>
          <GameScene 
            players={players} 
            tiles={tiles}
            localPlayerIdentity={identity} 
            onPlayerRotation={handlePlayerRotation}
            currentInputRef={currentInputRef}
            isDebugPanelVisible={isDebugPanelExpanded}
          />
          {/* Voting Panel only if localPlayer exists */} 
          {localPlayer && (
            <>
              <VotingPanel
                localPlayer={localPlayer}
                players={new Map(players)}
                conn={conn}
                votes={new Map(votes)}
                voting={new Map(votings)}
                timeRemaining={timeRemaining}
              />
            </>
          )}
        </>
      )}

      {/* Show status when not connected */} 
      {!connected && (
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%'}}><h1>{statusMessage}</h1></div>
      )}
    </div>
  );
}

export default App;
