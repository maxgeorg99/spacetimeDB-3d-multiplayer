/**
 * GameScene.tsx
 *
 * Core component that manages the 3D multiplayer game environment:
 *
 * Key functionality:
 * - Acts as the primary container for all 3D game elements
 * - Manages the game world environment (terrain, lighting, physics)
 * - Instantiates and coordinates player entities
 * - Handles multiplayer synchronization across clients
 * - Manages game state and lifecycle (start, join, disconnect)
 * - Maintains socket connections for real-time gameplay
 *
 * Props:
 * - players: Map of player data keyed by identity string
 * - tiles: Map of game tile data keyed by tileId string
 * - localPlayerIdentity: Identity of the local player
 * - onPlayerRotation: Callback for local player rotation changes
 * - currentInputRef: Ref containing the current input state for the local player
 * - isDebugPanelVisible: Flag to show/hide debug helpers
 *
 * Technical implementation:
 * - Uses React Three Fiber (R3F) for 3D rendering within React
 * - (Assumes physics system is handled elsewhere or within Player component)
 * - Manages state synchronization via props derived from Space Time DB
 * - Handles dynamic loading and instantiation of 3D assets implicitly via R3F components
 *
 * Related files:
 * - Player.tsx: Individual player entity component
 * - PlayerData, InputState, GameTile (from generated types)
 */

import React, { useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Box, Plane, Sky, Html } from '@react-three/drei';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
import { PlayerData, InputState, GameTile } from '../generated'; // Adjust path if needed
import { Identity } from '@clockworklabs/spacetimedb-sdk';
// Make sure to import the Player component correctly
import { Player } from './Player'; // Adjust path if needed

// --- Constants ---
const FLOOR_SIZE = 50;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 1;

// --- Helper Functions & Components ---

// createStoneTexture, StoneMaterial, WallSection, getTileInfo, Tile
// (These helper components remain the same as in your previous complete GameScene.tsx)
// ... (paste createStoneTexture function here) ...
// ... (paste StoneMaterial component here) ...
// ... (paste WallSection component here) ...
// ... (paste getTileInfo function here) ...
// ... (paste Tile component here) ...
const createStoneTexture = (color: string = '#8B4513') => {
    const width = 256;
    const height = 256;
    const size = width * height;
    const data = new Uint8Array(4 * size);
    const baseColor = new THREE.Color(color);

    for (let i = 0; i < size; i++) {
        const stride = i * 4;
        const x = i % width;
        const y = Math.floor(i / width);
        const noise = Math.random() * 0.2 + 0.8;
        const largeScale = Math.sin(x / 32) * Math.sin(y / 32) * 0.1;
        const r = Math.floor(baseColor.r * 255 * noise * (1 + largeScale));
        const g = Math.floor(baseColor.g * 255 * noise * (1 + largeScale));
        const b = Math.floor(baseColor.b * 255 * noise * (1 + largeScale));
        data[stride] = Math.min(255, Math.max(0, r));
        data[stride + 1] = Math.min(255, Math.max(0, g));
        data[stride + 2] = Math.min(255, Math.max(0, b));
        data[stride + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(FLOOR_SIZE / 8, FLOOR_SIZE / 8);
    texture.needsUpdate = true;
    return texture;
};
const StoneMaterial: React.FC<{ color?: string, roughness?: number, metalness?: number }> = ({ color = '#8B4513', roughness = 0.8, metalness = 0.1 }) => {
    const texture = useMemo(() => createStoneTexture(color), [color]);
    return (
        <meshStandardMaterial
            map={texture}
            roughness={roughness}
            metalness={metalness}
        />
    );
};
const WallSection: React.FC<{ args: [number, number, number], position: [number, number, number], rotation: [number, number, number] }> = ({ args, position, rotation }) => {
    const isHorizontal = rotation[1] === 0 || Math.abs(rotation[1]) === Math.PI;
    const wallLength = isHorizontal ? args[0] : args[2];
    const pillarSpacing = wallLength / 10;
    const pillarCount = Math.floor(wallLength / pillarSpacing);
    const pillarOffsets = Array.from({ length: pillarCount }, (_, i) => (i - (pillarCount - 1) / 2) * pillarSpacing);

    return (
        <group position={position} rotation={rotation}>
            <Box args={args} castShadow receiveShadow>
                <StoneMaterial color="#A9A9A9" roughness={0.9}/>
            </Box>
            {pillarOffsets.map((offset, i) => {
                const pillarPos: [number, number, number] = isHorizontal ? [offset, 0, args[2] * 0.6] : [args[0] * 0.6, 0, offset];
                const pillarHeight = args[1] * 1.05;
                const pillarSize: [number, number, number] = [WALL_THICKNESS * 1.2, pillarHeight, WALL_THICKNESS * 1.2];
                return (
                    <Box key={i} args={pillarSize} position={pillarPos} castShadow receiveShadow>
                        <meshStandardMaterial color="#693628" roughness={0.9} metalness={0.1} />
                    </Box>
                );
            })}
        </group>
    );
};
const getTileInfo = (position: { x: number, z: number }) => {
    const tileSize = 8;
    const zones = [ { x: -15, z: 0, size: "S", color: "#4CAF50" }, { x: -5, z: 0, size: "M", color: "#2196F3" }, { x: 5, z: 0, size: "L", color: "#FFC107" }, { x: 15, z: 0, size: "XL", color: "#F44336" }];
    const zoneCenterY = 0;
    for (const zone of zones) {
        const xMin = zone.x - tileSize / 2; const xMax = zone.x + tileSize / 2;
        const zMin = zoneCenterY - tileSize / 2; const zMax = zoneCenterY + tileSize / 2;
        if (position.x >= xMin && position.x <= xMax && position.z >= zMin && position.z <= zMax) { return { size: zone.size, color: zone.color }; }
    }
    return null;
};
const Tile: React.FC<{ tile: GameTile }> = ({ tile }) => {
    const position = tile.position || { x: 0, y: 0, z: 0 };
    const size = tile.size || { x: 8, y: 0.1, z: 8 }; // Keep very thin height
    const tileInfo = getTileInfo(position);
    const tileColor = tileInfo?.color || "#555555";
    
    return (
        <mesh position={[position.x, 0.01, position.z]} receiveShadow> {/* Keep slightly above ground to prevent z-fighting */}
            <boxGeometry args={[size.x, 0.02, size.z]} />
            <meshStandardMaterial 
                color={tileColor} 
                transparent 
                opacity={0.5}
                roughness={0.7}
                metalness={0.1}
            />
        </mesh>
    );
};


// Define structure expected by Player component (can also import from Player.tsx if exported)
interface ExtendedPlayerData extends PlayerData {
    currentTileDisplay?: string;
}

// Props interface for the GameScene component
interface GameSceneProps {
    players: ReadonlyMap<string, PlayerData>; // Use the base PlayerData from generated types
    tiles: ReadonlyMap<string, GameTile>;
    localPlayerIdentity: Identity | null;
    onPlayerRotation?: (rotation: THREE.Euler) => void;
    currentInputRef?: React.MutableRefObject<InputState | undefined>;
    isDebugPanelVisible?: boolean;
}

// --- Main Game Scene Component ---
export const GameScene: React.FC<GameSceneProps> = ({
    players,
    tiles,
    localPlayerIdentity,
    onPlayerRotation,
    currentInputRef,
    isDebugPanelVisible = false
}) => {
    const directionalLightRef = useRef<THREE.DirectionalLight>(null!);

    // Check if local player exists in the cache
    const localPlayerInCache = useMemo(() => {
        if (!localPlayerIdentity) return false;
        const playerIdString = localPlayerIdentity.toHexString();
        return players.has(playerIdString);
    }, [localPlayerIdentity, players]);

    // Process players to include T-shirt size zone information
    const playersWithTileInfo = useMemo(() => {
        return Array.from(players.values()).map(player => {
            const tileInfo = player.position ? getTileInfo(player.position) : null;
            const currentTileString = tileInfo ? `${tileInfo.size}` : 'None';

            // Return the original player object spread, plus the new display string
            return {
                ...player,
                currentTileDisplay: currentTileString,
            };
        });
    }, [players]);

    // Convert local Identity to string for comparison safely
    const localPlayerIdString = useMemo(() => localPlayerIdentity?.toHexString(), [localPlayerIdentity]);

    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
            <Canvas
                camera={{ position: [0, 5, 15], fov: 60 }}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}
                shadows
            >
                {/* Environment */}
                <Sky distance={450000} sunPosition={[5, 1, 8]} inclination={0} azimuth={0.25} />

                {/* Lighting */}
                <ambientLight intensity={0.6} />
                <directionalLight
                    ref={directionalLightRef}
                    position={[15, 20, 10]}
                    intensity={2.0}
                    castShadow
                    shadow-mapSize-width={2048} shadow-mapSize-height={2048}
                    shadow-bias={-0.0001}
                    shadow-camera-left={-FLOOR_SIZE / 2 - 2} shadow-camera-right={FLOOR_SIZE / 2 + 2}
                    shadow-camera-top={FLOOR_SIZE / 2 + 2} shadow-camera-bottom={-FLOOR_SIZE / 2 - 2}
                    shadow-camera-near={0.5} shadow-camera-far={60}
                />

                {/* Debug Helpers */}
                {isDebugPanelVisible && directionalLightRef.current && (
                    <>
                        <primitive object={new DirectionalLightHelper(directionalLightRef.current, 5)} />
                        <primitive object={new CameraHelper(directionalLightRef.current.shadow.camera)} />
                    </>
                )}

                {/* Floor */}
                <Plane args={[FLOOR_SIZE, FLOOR_SIZE]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                    <StoneMaterial color="#8B4513" roughness={1} />
                </Plane>

                {/* Walls */}
                <WallSection args={[FLOOR_SIZE, WALL_HEIGHT, WALL_THICKNESS]} position={[0, WALL_HEIGHT / 2, -FLOOR_SIZE / 2]} rotation={[0, 0, 0]} />
                <WallSection args={[FLOOR_SIZE, WALL_HEIGHT, WALL_THICKNESS]} position={[0, WALL_HEIGHT / 2, FLOOR_SIZE / 2]} rotation={[0, 0, 0]} />
                <WallSection args={[FLOOR_SIZE, WALL_HEIGHT, WALL_THICKNESS]} position={[FLOOR_SIZE / 2, WALL_HEIGHT / 2, 0]} rotation={[0, -Math.PI / 2, 0]} />
                <WallSection args={[FLOOR_SIZE, WALL_HEIGHT, WALL_THICKNESS]} position={[-FLOOR_SIZE / 2, WALL_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]} />

                {/* Wall Lighting */}
                {[
                    [-FLOOR_SIZE / 2 + 3, WALL_HEIGHT / 2, 0], [FLOOR_SIZE / 2 - 3, WALL_HEIGHT / 2, 0],
                    [0, WALL_HEIGHT / 2, -FLOOR_SIZE / 2 + 3], [0, WALL_HEIGHT / 2, FLOOR_SIZE / 2 - 3]
                ].map((pos, i) => (
                    <pointLight key={`pointlight-${i}`} position={pos as [number, number, number]} intensity={0.6} distance={15} decay={2} color="#ff8c69" castShadow={false} />
                ))}

                {/* Simple tile zones with clear labels */}
                {[
                    { pos: [-15, 0, 0], color: "#4CAF50", text: "S" },
                    { pos: [-5, 0, 0], color: "#2196F3", text: "M" },
                    { pos: [5, 0, 0], color: "#FFC107", text: "L" },
                    { pos: [15, 0, 0], color: "#F44336", text: "XL" }
                ].map(({ pos, color, text }) => (
                    <group key={text} position={[pos[0], 0, pos[2]]}>
                        {/* Simple flat colored tile */}
                        <mesh position={[0, 0.02, 0]} receiveShadow>
                            <boxGeometry args={[8, 0.04, 8]} />
                            <meshStandardMaterial 
                                color={color}
                                transparent
                                opacity={0.7}
                                roughness={0.7}
                                metalness={0.1}
                            />
                        </mesh>
                        {/* Size label */}
                        <Html
                            position={[0, 2, 0]}
                            center
                            distanceFactor={15}
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.8)',
                                padding: '15px 30px',
                                borderRadius: '10px',
                                fontSize: '48px',
                                fontWeight: 'bold',
                                color: 'white',
                                border: `2px solid ${color}`,
                                textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                                userSelect: 'none'
                            }}
                        >
                            {text}
                        </Html>
                    </group>
                ))}

                {/* Render actual Game Tiles from props */}
                {Array.from(tiles.values()).map((tile) => (
                    <Tile key={tile.tileId} tile={tile} />
                ))}

                {/* Render Players - Using the refined prop structure */}
                {playersWithTileInfo.map((player) => {
                    const playerIdString = player.identity?.toHexString();
                    if (!playerIdString) {
                        console.warn("Skipping player rendering due to missing identity.");
                        return null;
                    }
                    const isLocal = localPlayerIdString === playerIdString;

                    // Prepare the data ensuring defaults for required fields
                    const playerDataForComponent: ExtendedPlayerData = {
                        ...player,
                        identity: player.identity,
                        position: player.position || { x: 0, y: 0, z: 0 },
                        rotation: player.rotation || { x: 0, y: 0, z: 0 },
                        username: player.username || 'Unknown Player',
                        characterClass: player.characterClass || 'Wizard',
                        currentTileDisplay: player.currentTileDisplay
                    };

                    return (
                        <Player
                            key={playerIdString}
                            playerData={player}
                            isLocalPlayer={isLocal}
                            onRotationChange={isLocal ? onPlayerRotation : undefined}
                            currentInput={isLocal && localPlayerInCache? currentInputRef?.current : undefined}
                            isDebugArrowVisible={isLocal ? isDebugPanelVisible : false}
                            isDebugPanelVisible={isDebugPanelVisible}
                        />
                    );
                })}
            </Canvas>
        </div>
    );
};