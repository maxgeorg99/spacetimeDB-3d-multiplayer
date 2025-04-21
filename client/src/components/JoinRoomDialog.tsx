import { useState } from 'react';

interface JoinRoomDialogProps {
    roomName: string;
    roomPassword: string;
    onJoin: (password: string) => void;
    onCancel: () => void;
}

export function JoinRoomDialog({ roomName, roomPassword, onJoin, onCancel }: JoinRoomDialogProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | undefined>();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== roomPassword) {
            setError("Incorrect password");
            return;
        }
        setError(undefined);
        onJoin(password);
    };

    return (
        <div className="dialog-overlay">
            <div className="dialog-content">
                <h2>Enter password for room "{roomName}"</h2>
                
                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}
                
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="room-password">Password:</label>
                        <input
                            id="room-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter room password"
                            required
                            autoFocus
                        />
                    </div>
                    
                    <div className="form-actions">
                        <button type="submit" className="menu-button primary-button">
                            Join Room
                        </button>
                        <button 
                            type="button" 
                            className="menu-button secondary-button"
                            onClick={onCancel}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}