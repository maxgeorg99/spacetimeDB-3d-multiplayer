import { useState } from 'react';

interface Room {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
}

interface MainMenuProps {
  onCreateRoom: (name: string, password?: string) => void;
  onJoinRoom: (roomId: string, password?: string) => void;
  availableRooms: Room[];
  isConnected: boolean;
}

export function MainMenu({ 
  onCreateRoom, 
  onJoinRoom, 
  availableRooms,
  isConnected 
}: MainMenuProps) {
  const [newRoomName, setNewRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Handle room creation
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newRoomName.trim()) {
      try {
        await onCreateRoom(newRoomName, roomPassword);
        setNewRoomName('');
        setRoomPassword('');
        setShowCreateForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // Handle room selection
  const handleRoomSelect = async (roomId: string) => {
    const room = availableRooms.find(r => r.id === roomId);
    if (!room) {
      setError('Room not found');
      return;
    }
    
    if (room.playerCount >= room.maxPlayers) {
      setError(`Room "${room.name}" is full (${room.playerCount}/${room.maxPlayers} players)`);
      return;
    }

    setError(null);
    try {
      await onJoinRoom(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="main-menu">
      <div className="menu-container">
        <h1 className="menu-title">3D Scrum Poker</h1>
        
        {!isConnected && (
          <div className="connecting-status">
            <div className="spinner"></div>
            <p>Connecting to server...</p>
          </div>
        )}
        
        {isConnected && (
          <>
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
            
            <div className="menu-actions">
              <button 
                className="menu-button primary-button"
                onClick={() => setShowCreateForm(true)}
              >
                Create New Room
              </button>
            </div>
            
            {showCreateForm && (
              <div className="create-room-form">
                <h2>Create New Room</h2>
                <form onSubmit={handleCreateRoom}>
                  <div className="form-group">
                    <label htmlFor="room-name">Room Name:</label>
                    <input
                      id="room-name"
                      type="text"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="Enter room name"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label htmlFor="room-password">Password (optional):</label>
                    <input
                      id="room-password"
                      type="password"
                      value={roomPassword}
                      onChange={(e) => setRoomPassword(e.target.value)}
                      placeholder="Leave blank for public room"
                    />
                  </div>
                  
                  <div className="form-actions">
                    <button type="submit" className="menu-button primary-button">
                      Create Room
                    </button>
                    <button 
                      type="button" 
                      className="menu-button secondary-button"
                      onClick={() => setShowCreateForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
            
            <div className="available-rooms">
              <h2>Available Rooms</h2>
              {availableRooms.length === 0 ? (
                <p className="no-rooms-message">No rooms available. Create one to get started!</p>
              ) : (
                <ul className="room-list">
                  {availableRooms.map(room => (
                    <li 
                      key={room.id} 
                      className={`room-item ${room.playerCount >= room.maxPlayers ? 'room-full' : ''}`}
                      onClick={() => handleRoomSelect(room.id)}
                    >
                      <div className="room-info">
                        <span className="room-name">{room.name}</span>
                        <span className="room-players" style={{ 
                          color: room.playerCount >= room.maxPlayers ? '#ff5252' : 'inherit' 
                        }}>
                          {room.playerCount} / {room.maxPlayers} players
                        </span>
                      </div>
                      {room.hasPassword && (
                        <span className="room-password-indicator">🔒</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}