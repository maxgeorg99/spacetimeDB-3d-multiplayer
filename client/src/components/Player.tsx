/**
 * Player.tsx
 *
 * Component responsible for rendering and controlling individual player entities:
 * // ... (rest of the documentation comments remain the same)
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAnimations, Html, Sphere } from '@react-three/drei'; // Assuming Sphere might be used for debug/hitbox
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PlayerData, InputState } from '../generated'; // Adjust path if needed

// Define animation names for reuse
const ANIMATIONS = {
    IDLE: 'idle',
    WALK_FORWARD: 'walk-forward',
    WALK_BACK: 'walk-back',
    WALK_LEFT: 'walk-left',
    WALK_RIGHT: 'walk-right',
    RUN_FORWARD: 'run-forward',
    RUN_BACK: 'run-back',
    RUN_LEFT: 'run-left',
    RUN_RIGHT: 'run-right',
    JUMP: 'jump',
    ATTACK: 'attack1',
    CAST: 'cast',
    DAMAGE: 'damage',
    DEATH: 'death',
};

// --- Client-side Constants ---
const PLAYER_SPEED = 5.0; // Match server logic
const SPRINT_MULTIPLIER = 1.8; // Match server logic
const PLAYER_ROTATION_SPEED = Math.PI * 2; // Radians per second for smooth remote player rotation lerp

// --- Client-side Prediction Constants ---
const SERVER_TICK_RATE = 60; // Assuming server runs at 60Hz
const SERVER_TICK_DELTA = 1 / SERVER_TICK_RATE; // Use this for prediction
const POSITION_RECONCILE_THRESHOLD_SQ = 0.4 * 0.4; // Use squared distance for efficiency
const ROTATION_RECONCILE_THRESHOLD = 0.1; // Radians
const RECONCILE_LERP_FACTOR = 0.15; // Smoothing factor for reconciliation lerp

// --- Camera Constants ---
const CAMERA_MODES = {
    FOLLOW: 'follow',  // Default camera following behind player
    ORBITAL: 'orbital' // Orbital camera that rotates around the player
};
const CAMERA_LOOK_AT_OFFSET = new THREE.Vector3(0, 1.5, 0); // Point camera slightly above player base

// Interface combining PlayerData with client-side display info
interface ExtendedPlayerData extends PlayerData {
    currentTileDisplay?: string; // Optional display string from GameScene
}

// Props for the Player component
interface PlayerProps {
    playerData: ExtendedPlayerData;
    isLocalPlayer: boolean;
    onRotationChange?: (rotation: THREE.Euler) => void; // Callback for local player rotation changes
    currentInput?: InputState; // Current input state for the local player
    isDebugArrowVisible?: boolean; // Show debug forward vector arrow
    isDebugPanelVisible?: boolean; // Show general debug helpers
}

export const Player: React.FC<PlayerProps> = ({
    playerData,
    isLocalPlayer,
    onRotationChange,
    currentInput,
    isDebugArrowVisible = false,
    isDebugPanelVisible = false
}) => {
    const group = useRef<THREE.Group>(null!);
    const { camera } = useThree();
    const characterClass = playerData.characterClass || 'Wizard'; // Default to Wizard

    // Model management state
    const [modelLoaded, setModelLoaded] = useState(false);
    const [model, setModel] = useState<THREE.Group | null>(null);
    const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
    const [animations, setAnimations] = useState<Record<string, THREE.AnimationAction>>({});
    const [currentAnimation, setCurrentAnimation] = useState<string>(ANIMATIONS.IDLE);
    const animationsLoadedRef = useRef(false); // Track if animations attempted loading

    // --- Client Prediction State (Local Player Only) ---
    // Store predicted position and rotation locally
    const localPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(playerData.position?.x || 0, playerData.position?.y || 0, playerData.position?.z || 0));
    // Use YXZ Euler order for intuitive yaw control from mouse
    const localRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, playerData.rotation?.y || 0, 0, 'YXZ'));

    // --- Remote Player State ---
    // Store the last known server state for remote players for lerping
    const lastServerPosition = useRef<THREE.Vector3>(new THREE.Vector3(playerData.position?.x || 0, playerData.position?.y || 0, playerData.position?.z || 0));
    const lastServerRotationY = useRef<number>(playerData.rotation?.y || 0);

    // --- Debugging Refs ---
    const debugArrowRef = useRef<THREE.ArrowHelper | null>(null);
    const pointLightRef = useRef<THREE.PointLight>(null!); // Ref for the declarative light if used

    // --- Camera Control State (Local Player Only) ---
    const isPointerLocked = useRef(false);
    const zoomLevel = useRef(5); // Current camera distance (follow mode)
    const targetZoom = useRef(5); // Target camera distance for smooth zoom
    const [cameraMode, setCameraMode] = useState<string>(CAMERA_MODES.FOLLOW);
    const orbitalCameraRef = useRef({
        distance: 8,
        height: 3,
        angle: 0,
        elevation: Math.PI / 6, // Approx 30 degrees
        autoRotate: false,
        autoRotateSpeed: 0.5,
        lastUpdateTime: Date.now(),
        playerFacingRotation: 0 // Stores player's Y rotation when entering orbital mode
    });

    // --- Model Path Determination ---
    const mainModelPath = useMemo(() => {
        switch (characterClass) {
            case 'Paladin': return '/models/paladin/paladin.fbx';
            case 'Wizard': return '/models/wizard/wizard.fbx';
            case 'Mario': return '/models/mario/mario.fbx';
            default: return '/models/wizard/wizard.fbx';
        }
    }, [characterClass]);

    // --- Client-Side Movement Calculation (Prediction) ---
    const calculateClientMovement = useCallback((currentPos: THREE.Vector3, currentRotY: number, inputState: InputState, delta: number): THREE.Vector3 => {
      // ... (guard clauses, speed calculation) ...
      const speed = inputState.sprint ? PLAYER_SPEED * SPRINT_MULTIPLIER : PLAYER_SPEED;
      let localMoveX = 0;
      let localMoveZ = 0;
  
      if (cameraMode === CAMERA_MODES.ORBITAL) {
          // ... (keep orbital logic as is for now) ...
      } else { // FOLLOW mode - Fix the movement mapping
          // --- CORRECTED INPUT MAPPING ---
          if (inputState.forward) localMoveZ -= 1; // Forward is negative Z in Three.js
          if (inputState.backward) localMoveZ += 1; // Backward is positive Z
          if (inputState.left) localMoveX -= 1;    // Left is negative X
          if (inputState.right) localMoveX += 1;   // Right is positive X
          // --- END CORRECTED INPUT MAPPING ---
      }
  
      // ... (rest of vector normalization, rotation, scaling) ...
      const localMoveVector = new THREE.Vector3(localMoveX, 0, localMoveZ);
      if (localMoveVector.lengthSq() > 0) {
          localMoveVector.normalize();
      }
      const rotationYaw = (cameraMode === CAMERA_MODES.ORBITAL)
          ? orbitalCameraRef.current.playerFacingRotation
          : currentRotY; // Use the group's direct rotation
      const worldMoveVector = localMoveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationYaw);
      worldMoveVector.multiplyScalar(speed * delta);
      return currentPos.clone().add(worldMoveVector);
  
  }, [cameraMode]);

    // --- Effect for Model Loading ---
    useEffect(() => {
        const loader = new FBXLoader();
        let currentModel: THREE.Group | null = null; // Track model being loaded in this effect instance

        loader.load(
            mainModelPath,
            (fbx) => {
                currentModel = fbx; // Assign loaded model
                if (characterClass === 'Paladin') {
                    fbx.scale.setScalar(1.0);
                }
                else if (characterClass === 'Mario') {
                  fbx.scale.setScalar(0.0125); //Mario scale
                } else {
                    fbx.scale.setScalar(0.02); // Wizard scale
                }
                fbx.position.set(0, characterClass === 'Mario' ? -1 : -0.1, 0); // Adjust vertical position

                fbx.rotation.y = Math.PI; // Face the player forward

                // Add model to the group ref
                if (group.current) {
                    group.current.add(fbx);
                }

                // Traverse AFTER adding to group to remove embedded lights
                 try {
                     fbx.traverse((child) => {
                         if (child instanceof THREE.Light) {
                             console.log(`[Player ${playerData.username}] Removing embedded light: ${child.name || 'Unnamed'} (${child.type})`);
                             child.removeFromParent();
                         }
                     });
                 } catch (traverseError) {
                    console.error(`[Player ${playerData.username}] Error during fbx.traverse for light removal:`, traverseError);
                 }

                // Initialize animation mixer
                const newMixer = new THREE.AnimationMixer(fbx);
                setMixer(newMixer);
                setModel(fbx); // Set model state
                setModelLoaded(true);
                animationsLoadedRef.current = false; // Reset flag to allow animation loading

                // Set initial local state for the local player
                if (isLocalPlayer && playerData.position && playerData.rotation) {
                    localPositionRef.current.set(playerData.position.x, playerData.position.y, playerData.position.z);
                    localRotationRef.current.set(0, playerData.rotation.y, 0, 'YXZ');
                    // Store initial rotation for orbital mode start
                    orbitalCameraRef.current.playerFacingRotation = playerData.rotation.y;
                } else if (!isLocalPlayer && playerData.position && playerData.rotation) {
                    // Set initial state for remote players for lerping
                    lastServerPosition.current.set(playerData.position.x, playerData.position.y, playerData.position.z);
                    lastServerRotationY.current = playerData.rotation.y;
                }
            },
            undefined, // Progress callback (optional)
            (error) => console.error(`[Player ${playerData.username}] Error loading model ${mainModelPath}:`, error)
        );

        // Cleanup function for the effect
        return () => {
            animationsLoadedRef.current = false; // Ensure flag is reset on cleanup/reload
            if (mixer) mixer.stopAllAction();
            if (currentModel && group.current) { // Use the model loaded in *this* effect instance
                 group.current.remove(currentModel);
                 // Consider adding geometry/material disposal here if needed
            }
            setModel(null);
            setMixer(null);
            setModelLoaded(false);
            setAnimations({}); // Clear animations state
            setCurrentAnimation(ANIMATIONS.IDLE);
        };
    }, [mainModelPath, characterClass, playerData.username, isLocalPlayer]); // Rerun if model path, class, username changes

    // --- Effect for Loading Animations ---
    useEffect(() => {
        // Only load if mixer exists, model is set, and animations haven't been loaded yet
        if (mixer && model && !animationsLoadedRef.current) {
            console.log(`[Player ${playerData.username}] Mixer/Model ready. Loading animations for ${characterClass}...`);
            animationsLoadedRef.current = true; // Set flag to prevent re-loading
            loadAnimations(mixer);
        }
    }, [mixer, model, characterClass, playerData.username]); // Depend on mixer, model, class


    // --- Animation Loading, Retargeting, In-Place Conversion Functions ---
    // (Using the functions provided in the previous prompt: loadAnimations, makeAnimationInPlace, retargetClip)
    // ... loadAnimations function (including checkCompletedLoading, loadAnimationFile) ...
    // ... makeAnimationInPlace function ...
    // ... retargetClip function ...
     // Function to load animations
    const loadAnimations = (mixerInstance: THREE.AnimationMixer) => {
        if (!mixerInstance) {
            console.error("Cannot load animations: mixer is not initialized");
            return;
        }

        console.log(`[Player ${playerData.username}] Loading animations for ${characterClass}...`);

        const animationPaths: Record<string, string> = {};
        const basePath = characterClass === 'Mario' ? '/models/mario/' : (characterClass === 'Paladin' ? '/models/paladin/' : '/models/wizard/');

        // Map animation keys to file paths (ensure exact matching of key names)
        const animKeys = {
            [ANIMATIONS.IDLE]: characterClass === 'Mario' ? 'mario-idle.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-idle.fbx' : 'paladin-idle.fbx'),
            [ANIMATIONS.WALK_FORWARD]: characterClass === 'Mario' ? 'mario-walk-forward.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-walk-forward.fbx' : 'paladin-walk-forward.fbx'),
            [ANIMATIONS.WALK_BACK]: characterClass === 'Mario' ? 'mario-walk-back.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-walk-back.fbx' : 'paladin-walk-back.fbx'),
            [ANIMATIONS.WALK_LEFT]: characterClass === 'Mario' ? 'mario-walk-left.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-walk-left.fbx' : 'paladin-walk-left.fbx'),
            [ANIMATIONS.WALK_RIGHT]: characterClass === 'Mario' ? 'mario-walk-right.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-walk-right.fbx' : 'paladin-walk-right.fbx'),
            [ANIMATIONS.RUN_FORWARD]: characterClass === 'Mario' ? 'mario-run-forward.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-run-forward.fbx' : 'paladin-run-forward.fbx'),
            [ANIMATIONS.RUN_BACK]: characterClass === 'Mario' ? 'mario-run-back.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-run-back.fbx' : 'paladin-run-back.fbx'),
            [ANIMATIONS.RUN_LEFT]: characterClass === 'Mario' ? 'mario-run-left.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-run-left.fbx' : 'paladin-run-left.fbx'),
            [ANIMATIONS.RUN_RIGHT]: characterClass === 'Mario' ? 'mario-run-right.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-run-right.fbx' : 'paladin-run-right.fbx'),
            [ANIMATIONS.JUMP]: characterClass === 'Mario' ? 'mario-jump.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-jump.fbx' : 'paladin-jump.fbx'), // Mario needs jump
            [ANIMATIONS.ATTACK]: characterClass === 'Mario' ? 'mario-attack.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-1h-magic-attack-01.fbx' : 'paladin-attack.fbx'),
            [ANIMATIONS.CAST]: characterClass === 'Mario' ? 'mario-idle.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-2h-magic-area-attack-02.fbx' : 'paladin-cast.fbx'), // Mario fallback
            [ANIMATIONS.DAMAGE]: characterClass === 'Mario' ? 'mario-idle.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-react-small-from-front.fbx' : 'paladin-damage.fbx'), // Mario fallback
            [ANIMATIONS.DEATH]: characterClass === 'Mario' ? 'mario-death.fbx' : (characterClass === 'Wizard' ? 'wizard-standing-react-death-backward.fbx' : 'paladin-death.fbx'), // Mario needs death
        };

        Object.entries(animKeys).forEach(([key, filename]) => {
            animationPaths[key] = `${basePath}${filename}`;
        });

        const loader = new FBXLoader();
        const newAnimations: Record<string, THREE.AnimationAction> = {};
        let loadedCount = 0;
        const totalCount = Object.keys(animationPaths).length;
        console.log(`[Player ${playerData.username}] Attempting to load ${totalCount} animations...`);

        const checkCompletedLoading = () => {
            loadedCount++;
            if (loadedCount === totalCount) {
                const successCount = Object.keys(newAnimations).length;
                console.log(`[Player ${playerData.username}] Animation loading complete. Success: ${successCount}/${totalCount}.`);
                setAnimations(newAnimations); // Update state with loaded animations
                // Play initial animation after a short delay
                setTimeout(() => {
                     if (newAnimations[ANIMATIONS.IDLE]) {
                        console.log(`[Player ${playerData.username}] Playing initial idle animation.`);
                        const idleAction = newAnimations[ANIMATIONS.IDLE];
                        idleAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.3).play();
                        setCurrentAnimation(ANIMATIONS.IDLE);
                     } else {
                        console.warn(`[Player ${playerData.username}] Idle animation not found after loading.`);
                     }
                }, 50); // Delay to allow state update
            }
        };

        const loadAnimationFile = (name: string, path: string, mixerInstance: THREE.AnimationMixer) => {
            loader.load(
                path,
                (animFbx) => {
                    try {
                        if (!animFbx.animations || animFbx.animations.length === 0) throw new Error(`No animations found in FBX file`);
                        const clip = animFbx.animations[0];
                        clip.name = name; // Assign the logical name
                        const retargetedClip = retargetClip(clip, path); // Retarget if needed
                        makeAnimationInPlace(retargetedClip); // Remove root motion
                        const action = mixerInstance.clipAction(retargetedClip);
                        newAnimations[name] = action; // Store the action

                        // Set loop mode
                        if (name === ANIMATIONS.IDLE || name.startsWith('walk-') || name.startsWith('run-')) {
                            action.setLoop(THREE.LoopRepeat, Infinity);
                        } else {
                            action.setLoop(THREE.LoopOnce, 1);
                            action.clampWhenFinished = true;
                        }
                        console.log(`[Player ${playerData.username}] ✅ Loaded animation: ${name}`);
                    } catch (e: any) {
                        console.error(`[Player ${playerData.username}] Error processing animation ${name} from ${path}:`, e.message);
                    }
                    checkCompletedLoading();
                },
                undefined, // Progress callback
                (error) => {
                    console.error(`[Player ${playerData.username}] Error loading animation ${name} from ${path}:`, error);
                    checkCompletedLoading();
                }
            );
        };

        // Check file existence before loading (optional but good practice)
        Object.entries(animationPaths).forEach(([name, path]) => {
            fetch(path, { method: 'HEAD' }) // Use HEAD request to check existence without downloading
                .then(response => {
                    if (!response.ok) {
                        console.warn(`[Player ${playerData.username}] Animation file not found (or not accessible): ${path} (${response.status})`);
                        checkCompletedLoading(); // Count as processed (failed)
                    } else {
                        loadAnimationFile(name, path, mixerInstance); // File exists, load it
                    }
                })
                .catch(error => {
                    console.error(`[Player ${playerData.username}] Network error checking animation file ${path}:`, error);
                    checkCompletedLoading(); // Count as processed (failed)
                });
        });
    };
     // Improve root motion removal function
    const makeAnimationInPlace = (clip: THREE.AnimationClip) => {
        const tracks = clip.tracks;
        const positionTracks = tracks.filter(track => track.name.endsWith('.position'));
        if (positionTracks.length === 0) return;

        let rootTrack: THREE.KeyframeTrack | undefined;
        const rootNames = ['Hips.position', 'mixamorigHips.position', 'root.position', 'Armature.position', 'Root.position']; // Common root bone names
        rootTrack = positionTracks.find(track => rootNames.some(name => track.name.toLowerCase().includes(name.toLowerCase())));
        rootTrack = rootTrack || positionTracks[0]; // Fallback to first position track

        const rootTrackNameBase = rootTrack.name.split('.')[0];

        // Filter out root position tracks (X and Z mostly, consider keeping Y for jumps later if needed)
        clip.tracks = tracks.filter(track => !track.name.startsWith(`${rootTrackNameBase}.position`));
    };
     // Add a retargetClip function after makeAnimationInPlace
    const retargetClip = (clip: THREE.AnimationClip, sourceModelPath: string): THREE.AnimationClip => {
        if (!model) return clip; // Cannot retarget without target model skeleton

        const sourceFileName = sourceModelPath.split('/').pop()?.split('.')[0] || '';
        const targetFileName = mainModelPath.split('/').pop()?.split('.')[0] || '';

        if (sourceFileName === targetFileName) return clip; // Same skeleton, no retargeting needed

        // console.log(`[Player ${playerData.username}] Retargeting anim "${clip.name}" from "${sourceFileName}" to "${targetFileName}"`);

        // Basic retargeting assumption: bone names might be the same or require simple mapping
        // In a real scenario, you might need a detailed bone mapping dictionary here
        // For now, we'll assume names are compatible or don't need changing
        const newTracks = clip.tracks.map(track => {
            const trackNameParts = track.name.split('.');
            if (trackNameParts.length < 2) return track; // Malformed track name

            let boneName = trackNameParts[0];
            const property = trackNameParts.slice(1).join('.');

            // --- Placeholder for Bone Name Mapping ---
            // Example: if (boneName === 'SourceRoot') boneName = 'TargetRoot';
            // Add specific mappings based on your model skeletons if needed
            // --- End Placeholder ---

            const newTrackName = `${boneName}.${property}`;
            if (newTrackName === track.name) return track; // Return original if name doesn't change

            // Create new track with potentially updated name
            let newTrack: THREE.KeyframeTrack;
            const times = Array.from(track.times);
            const values = Array.from(track.values);
            if (track instanceof THREE.QuaternionKeyframeTrack) newTrack = new THREE.QuaternionKeyframeTrack(newTrackName, times, values);
            else if (track instanceof THREE.VectorKeyframeTrack) newTrack = new THREE.VectorKeyframeTrack(newTrackName, times, values);
            else newTrack = new THREE.KeyframeTrack(newTrackName, times, values); // Fallback

            return newTrack;
        });

        return new THREE.AnimationClip(clip.name, clip.duration, newTracks, clip.blendMode);
    };

    // --- Animation Playback Function ---
    const playAnimation = useCallback((name: string, crossfadeDuration = 0.3) => {
        if (!mixer || !modelLoaded || !animationsLoadedRef.current) return; // Guard: Ensure everything is ready

        let targetAction = animations[name];

        // Handle missing animation: fallback to idle
        if (!targetAction) {
            if (name !== ANIMATIONS.IDLE && animations[ANIMATIONS.IDLE]) {
                // console.warn(`[Player ${playerData.username}] Animation "${name}" not found. Falling back to idle.`);
                name = ANIMATIONS.IDLE;
                targetAction = animations[name];
            } else {
                console.error(`[Player ${playerData.username}] Animation "${name}" not found, and fallback idle animation is also missing.`);
                return; // Cannot play anything
            }
        }

        // Prevent redundant plays of the same looping animation
        if (currentAnimation === name && targetAction.isRunning() && targetAction.loop === THREE.LoopRepeat) {
             return;
        }

        const currentAction = animations[currentAnimation];

        // Fade out previous animation
        if (currentAction && currentAction !== targetAction) {
            currentAction.fadeOut(crossfadeDuration);
        }

        // Fade in and play target animation
        targetAction
            .reset()
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
            .fadeIn(crossfadeDuration)
            .play();

        setCurrentAnimation(name); // Update current animation state

    }, [animations, currentAnimation, mixer, modelLoaded]); // Dependencies for playback logic

    // --- Effect for Shadow Properties ---
    useEffect(() => {
        if (model && group.current) {
            group.current.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true; // Allow player model to receive shadows too
                }
            });
        }
    }, [model]); // Run when model changes


    // --- Effect for Pointer Lock & Camera Control ---
    useEffect(() => {
        if (!isLocalPlayer) return; // Only for local player

        const handlePointerLockChange = () => {
            const locked = document.pointerLockElement === document.body;
            isPointerLocked.current = locked;
            document.body.style.cursor = locked ? 'none' : 'default'; // Hide cursor when locked
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isPointerLocked.current) return;

            const sensitivity = 0.003;
            if (cameraMode === CAMERA_MODES.FOLLOW) {
                // Update player rotation (Y-axis)
                localRotationRef.current.y -= e.movementX * sensitivity;
                // Keep yaw between -PI and PI
                localRotationRef.current.y = THREE.MathUtils.euclideanModulo(localRotationRef.current.y + Math.PI, 2 * Math.PI) - Math.PI;

                // Call the rotation change callback (sends rotation to GameScene/server)
                onRotationChange?.(localRotationRef.current);

            } else { // ORBITAL mode
                const orbital = orbitalCameraRef.current;
                orbital.angle -= e.movementX * sensitivity * 1.5; // Slightly faster orbital rotation
                orbital.elevation += e.movementY * sensitivity;
                // Clamp elevation
                orbital.elevation = Math.max(Math.PI / 12, Math.min(Math.PI / 2.1, orbital.elevation));
            }
        };

        const handleMouseWheel = (e: WheelEvent) => {
             const zoomSpeed = 0.8;
             const zoomChange = Math.sign(e.deltaY) * zoomSpeed;

             if (cameraMode === CAMERA_MODES.FOLLOW) {
                targetZoom.current = Math.max(2.0, Math.min(12.0, targetZoom.current + zoomChange));
             } else { // ORBITAL mode
                const orbital = orbitalCameraRef.current;
                orbital.distance = Math.max(3.0, Math.min(20.0, orbital.distance + zoomChange));
             }
        };

        // Request pointer lock on click
        const handleCanvasClick = (e: MouseEvent) => {
            // Only lock if clicking on the canvas itself
            if (!isPointerLocked.current && (e.target as HTMLElement)?.tagName === 'CANVAS') {
                document.body.requestPointerLock();
            }
        };

        // --- Key Down Listener for Camera Mode Toggle ---
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'c' || e.key === 'C') { // Toggle camera on 'C' key
                setCameraMode(prevMode => {
                    const newMode = prevMode === CAMERA_MODES.FOLLOW ? CAMERA_MODES.ORBITAL : CAMERA_MODES.FOLLOW;
                    if (newMode === CAMERA_MODES.ORBITAL) {
                        // Store current player facing direction when entering orbital
                        orbitalCameraRef.current.playerFacingRotation = localRotationRef.current.y;
                        // Reset orbital angle to be behind the player initially
                        orbitalCameraRef.current.angle = 0; // Angle relative to stored facing rotation
                    }
                    console.log(`Camera mode toggled to: ${newMode}`);
                    return newMode;
                });
            }
        };

        document.addEventListener('pointerlockchange', handlePointerLockChange);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('wheel', handleMouseWheel);
        document.addEventListener('click', handleCanvasClick);
        document.addEventListener('keydown', handleKeyDown); // Add key listener

        // Initial cursor state check
        handlePointerLockChange();

        return () => {
            document.removeEventListener('pointerlockchange', handlePointerLockChange);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('wheel', handleMouseWheel);
            document.removeEventListener('click', handleCanvasClick);
            document.removeEventListener('keydown', handleKeyDown); // Remove key listener
            if (document.pointerLockElement === document.body) {
                 document.exitPointerLock(); // Ensure pointer lock is released on unmount
            }
            document.body.style.cursor = 'default'; // Restore cursor
        };
    }, [isLocalPlayer, onRotationChange, cameraMode]); // Re-run if camera mode changes


    // --- Effect for Handling Animation Completion ---
    // (This completes the cut-off useEffect from the prompt)
    useEffect(() => {
        if (!mixer) return;

        const onAnimationFinished = (event: any) => {
            // Check if the finished animation is one of the non-looping ones
            if (
                event.action === animations[ANIMATIONS.JUMP] ||
                event.action === animations[ANIMATIONS.ATTACK] ||
                event.action === animations[ANIMATIONS.CAST] ||
                event.action === animations[ANIMATIONS.DAMAGE] ||
                event.action === animations[ANIMATIONS.DEATH] // Death might stay finished
            ) {
                 // Don't automatically go to idle if dead
                 if (event.action !== animations[ANIMATIONS.DEATH]) {
                    // console.log(`Animation ${event.action.getClip().name} finished, returning to idle.`);
                    playAnimation(ANIMATIONS.IDLE, 0.1); // Quick fade back to idle
                 } else {
                    // console.log("Death animation finished.");
                    // Optionally stop the mixer or handle respawn logic elsewhere
                 }
            }
        };

        mixer.addEventListener('finished', onAnimationFinished);

        return () => {
            if (mixer) {
                mixer.removeEventListener('finished', onAnimationFinished);
            }
        };
    }, [mixer, animations, playAnimation]); // Depend on mixer, loaded animations, and playback function

    // --- Frame Update Logic (useFrame) ---
    useFrame((state, delta) => {
        if (!group.current || !modelLoaded) return; // Ensure group and model are ready

        // Cap delta to prevent large jumps on lag/pause
        const cappedDelta = Math.min(delta, 1 / 30); // Max delta corresponds to 30 FPS

        // 1. Update Animation Mixer
        mixer?.update(cappedDelta);

        // 2. Handle Local Player Logic (Prediction, Reconciliation, Camera)
        if (isLocalPlayer) {
            // Get current server state from props
            const serverPos = playerData.position;
            const serverRotY = playerData.rotation?.y; // Only need Yaw for reconciliation

            // A. Predict next position based on current input
            let predictedPos = localPositionRef.current; // Start with last known local position
            if (currentInput) {
                predictedPos = calculateClientMovement(localPositionRef.current, localRotationRef.current.y, currentInput, cappedDelta);
            }
            localPositionRef.current.copy(predictedPos); // Update local ref with predicted position

            // B. Reconciliation (if server state is available)
            if (serverPos && serverRotY !== undefined) {
                 const posDiffSq = localPositionRef.current.distanceToSquared(serverPos);
                 const rotDiff = Math.abs(THREE.MathUtils.euclideanModulo(localRotationRef.current.y - serverRotY + Math.PI, Math.PI * 2) - Math.PI);

                 // If discrepancy is too large, lerp local state towards server state
                 if (posDiffSq > POSITION_RECONCILE_THRESHOLD_SQ) {
                    localPositionRef.current.lerp(serverPos, RECONCILE_LERP_FACTOR);
                    // console.log(`Reconciling position... DiffSq: ${posDiffSq.toFixed(3)}`);
                 }
                 if (rotDiff > ROTATION_RECONCILE_THRESHOLD) {
                    // Lerp yaw angle smoothly
                    localRotationRef.current.y = THREE.MathUtils.lerp(localRotationRef.current.y, serverRotY, RECONCILE_LERP_FACTOR);
                    // Wrap lerped angle
                    localRotationRef.current.y = THREE.MathUtils.euclideanModulo(localRotationRef.current.y + Math.PI, 2 * Math.PI) - Math.PI;
                    // console.log(`Reconciling rotation... Diff: ${rotDiff.toFixed(3)}`);
                 }
            }

            // C. Apply final (predicted/reconciled) state to the visual group
            group.current.position.copy(localPositionRef.current);
            group.current.rotation.copy(localRotationRef.current);

            // D. Update Camera Position and Target
            const playerHeadPosition = localPositionRef.current.clone().add(CAMERA_LOOK_AT_OFFSET);
            if (cameraMode === CAMERA_MODES.FOLLOW) {
                // Smooth zoom
                zoomLevel.current = THREE.MathUtils.lerp(zoomLevel.current, targetZoom.current, 0.1);

                // Calculate camera offset based on player rotation and zoom
                const cameraOffset = new THREE.Vector3(0, 0, zoomLevel.current); // Z is distance behind
                cameraOffset.applyEuler(localRotationRef.current); // Rotate offset by player yaw
                cameraOffset.y += 2.0; // Add some height to camera position

                // Set camera position relative to player
                const targetCameraPosition = localPositionRef.current.clone().add(cameraOffset);
                camera.position.lerp(targetCameraPosition, 0.1); // Smooth camera movement

            } else { // ORBITAL mode
                 const orbital = orbitalCameraRef.current;
                 // Calculate orbital camera position
                 const camX = orbital.distance * Math.sin(orbital.angle) * Math.cos(orbital.elevation);
                 const camZ = orbital.distance * Math.cos(orbital.angle) * Math.cos(orbital.elevation);
                 const camY = orbital.distance * Math.sin(orbital.elevation);

                 // Position is relative to player head + fixed rotation offset
                 const relativeCamPos = new THREE.Vector3(camX, camY, camZ);
                 // Rotate this relative position by the stored player facing direction
                 relativeCamPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbital.playerFacingRotation);

                 const targetCameraPosition = playerHeadPosition.clone().add(relativeCamPos);
                 camera.position.lerp(targetCameraPosition, 0.1); // Smooth camera movement
            }
             camera.lookAt(playerHeadPosition); // Always look at player head

            // E. Determine and Play Local Player Animation based on Input
            let desiredAnimation = ANIMATIONS.IDLE;
            if (currentInput) {
                // Prioritize actions
                if (currentInput.attack) desiredAnimation = ANIMATIONS.ATTACK;
                else if (currentInput.jump) desiredAnimation = ANIMATIONS.JUMP; // Add jump check
                else if (currentInput.castSpell) desiredAnimation = ANIMATIONS.CAST; // Add cast check
                // Then movement
                else if (currentInput.forward) desiredAnimation = currentInput.sprint ? ANIMATIONS.RUN_FORWARD : ANIMATIONS.WALK_FORWARD;
                else if (currentInput.backward) desiredAnimation = currentInput.sprint ? ANIMATIONS.RUN_BACK : ANIMATIONS.WALK_BACK;
                else if (currentInput.left) desiredAnimation = currentInput.sprint ? ANIMATIONS.RUN_LEFT : ANIMATIONS.WALK_LEFT;
                else if (currentInput.right) desiredAnimation = currentInput.sprint ? ANIMATIONS.RUN_RIGHT : ANIMATIONS.WALK_RIGHT;
            }
            // Play the determined animation (unless a non-looping one is already playing)
            if (currentAnimation !== desiredAnimation && animations[currentAnimation]?.loop !== THREE.LoopOnce) {
                playAnimation(desiredAnimation);
            }


            // F. Update Debug Arrow if visible
            if (isDebugArrowVisible) {
                 if (!debugArrowRef.current) {
                    // Create arrow helper if it doesn't exist
                    debugArrowRef.current = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(0,1,0), 1.5, 0xff0000);
                    group.current.add(debugArrowRef.current);
                 }
                 // No need to update direction if it's parented and parent rotates
                 // debugArrowRef.current.setDirection(new THREE.Vector3(0, 0, -1).applyEuler(localRotationRef.current));
            } else if (debugArrowRef.current) {
                 // Remove arrow if visibility is toggled off
                 group.current.remove(debugArrowRef.current);
                 debugArrowRef.current = null;
            }

        }
        // 3. Handle Remote Player Logic (Interpolation)
        else {
            const targetPos = playerData.position;
            const targetRotY = playerData.rotation?.y;

            if (targetPos) {
                // Lerp position smoothly towards the target server position
                group.current.position.lerp(targetPos, 0.2); // Adjust lerp factor for desired smoothness
                lastServerPosition.current.copy(targetPos); // Update last known position
            }

            if (targetRotY !== undefined) {
                 // Use spherical interpolation (SLERP) or simple angle lerp for rotation Y
                 // Lerp towards the target Y rotation smoothly
                 const currentRotY = group.current.rotation.y;
                 const shortestAngle = THREE.MathUtils.euclideanModulo(targetRotY - currentRotY + Math.PI, 2 * Math.PI) - Math.PI;
                 const lerpedRotY = currentRotY + shortestAngle * 0.2; // Adjust lerp factor
                 group.current.rotation.y = lerpedRotY;
                 lastServerRotationY.current = targetRotY; // Update last known rotation
            }

            // Determine Remote Player Animation (Example: based on velocity)
            const velocity = group.current.position.distanceTo(lastServerPosition.current) / cappedDelta; // Approx velocity
            let desiredAnimation = ANIMATIONS.IDLE;
             if (velocity > PLAYER_SPEED * SPRINT_MULTIPLIER * 0.8) { // Approximate running speed threshold
                 desiredAnimation = ANIMATIONS.RUN_FORWARD; // Simplification: assume running forward
             } else if (velocity > PLAYER_SPEED * 0.5) { // Approximate walking speed threshold
                 desiredAnimation = ANIMATIONS.WALK_FORWARD; // Simplification: assume walking forward
             }
             // TODO: Ideally, get animation state (attacking, jumping) from PlayerData
             if (currentAnimation !== desiredAnimation && animations[currentAnimation]?.loop !== THREE.LoopOnce) {
                 playAnimation(desiredAnimation);
             }
        }

    }); // End useFrame

    // --- Render Player ---
    return (
        <group ref={group} name={`player-${playerData.username}`}>
            {/* Model is added dynamically in useEffect */}

            {/* Player Name Tag */}
            {modelLoaded && (
                <Html
                    position={[0, 2.5, 0]}
                    center
                    distanceFactor={8}
                    occlude={false}
                    style={{
                        transition: 'all 0.2s',
                        opacity: 1,
                        transform: 'scale(1.5)'
                    }}
                >
                    <div style={{
                        color: isLocalPlayer ? '#00ffff' : '#ffffff',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                        userSelect: 'none',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                    }}>
                        {playerData.username}
                        {playerData.currentTileDisplay && playerData.currentTileDisplay !== 'None' && (
                            <div style={{ fontSize: '0.8em', opacity: 0.8 }}>
                                Size: {playerData.currentTileDisplay}
                            </div>
                        )}
                    </div>
                </Html>
            )}

             {/* Optional Debug Sphere for Position */}
             {isDebugPanelVisible && (
                 <Sphere args={[0.2]} position={[0, 0, 0]}>
                    <meshBasicMaterial color={isLocalPlayer ? "blue" : "red"} wireframe />
                 </Sphere>
             )}

            {/* Declarative Point Light (example - could be removed if scene lighting is sufficient) */}
            {/* <pointLight ref={pointLightRef} intensity={0.5} distance={5} position={[0, 1.5, 0]} castShadow={false} /> */}
        </group>
    );
};