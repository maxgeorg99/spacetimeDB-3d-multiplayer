import React, { useEffect } from 'react';
import { PlayerData, DbConnection, Vote, Voting, VotingStatus } from '../generated';

interface VotingPanelProps {
  localPlayer: PlayerData | null;
  players: Map<string, PlayerData>;
  conn: DbConnection | null;
  votes: Map<string, Vote>;
  voting: Map<string, Voting>;
  timeRemaining: number;
}

export const VotingPanel: React.FC<VotingPanelProps> = ({ 
  localPlayer, 
  players, 
  conn,
  votes,
  voting,
  timeRemaining
}) => {
  const getCurrentVoting = () => {
    if (!localPlayer) return null;
    return Array.from(voting.values())
      .find(v => v.roomName === localPlayer.roomName && v.status === VotingStatus.Pending);
  };

  const getCurrentVotes = () => {
    const currentVoting = getCurrentVoting();
    if (!currentVoting) return [];
    return Array.from(votes.values())
      .filter(v => v.votingId === currentVoting.votingId)
      .map(v => {
        const player = Array.from(players.values()).find(p => p.identity.toHexString() === v.playerIdentity.toHexString());
        return {
          name: player?.username || 'Unknown',
          vote: v.voteValue
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const hasPlayerVoted = () => {
    const currentVoting = getCurrentVoting();
    if (!currentVoting || !localPlayer) return false;
    return Array.from(votes.values())
      .some(v => 
        v.votingId === currentVoting.votingId && 
        v.playerIdentity.toHexString() === localPlayer.identity.toHexString()
      );
  };

  const getTileInfo = (position: { x: number, z: number }) => {
    const tileSize = 8;
    const tiles = [
      { x: -15, z: 0, size: "S" },
      { x: -5, z: 0, size: "M" },
      { x: 5, z: 0, size: "L" },
      { x: 15, z: 0, size: "XL" }
    ];
  
    for (const tile of tiles) {
      const xMin = tile.x - tileSize / 2;
      const xMax = tile.x + tileSize / 2;
      const zMin = tile.z - tileSize / 2;
      const zMax = tile.z + tileSize / 2;
  
      if (position.x >= xMin && position.x <= xMax &&
          position.z >= zMin && position.z <= zMax) {
        return tile;
      }
    }
    return null;
  };

  const startVoting = () => {
    if (!conn || !localPlayer) {
      console.log("[VotingPanel] Cannot start voting: no connection or player", { conn, localPlayer });
      return;
    }
    console.log("[VotingPanel] Starting voting for room:", localPlayer.roomName);
    conn.reducers.startVoting(localPlayer.roomName);
  };

  const submitVote = () => {
    if (!localPlayer || !conn) {
      console.log("[VotingPanel] Cannot submit vote: no connection or player", { conn, localPlayer });
      return;
    }
    const tileInfo = getTileInfo(localPlayer.position);
    console.log("[VotingPanel] Submitting vote with tile info:", tileInfo);
    if (tileInfo) {
      conn.reducers.submitVote(tileInfo.size);
    }
  };

  // Log state changes for debugging 
  const getCompletedVotingResults = () => {
    if (!localPlayer) return null;
    return Array.from(voting.values())
      .find(v => v.roomName === localPlayer.roomName && v.status === VotingStatus.Completed);
  };

  const currentVoting = getCurrentVoting();
  const completedVoting = getCompletedVotingResults();

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: '20px',
      borderRadius: '8px',
      color: 'white',
      minWidth: '200px',
      zIndex: 1500
    }}>
      <h3>Scrum Poker</h3>

      {!currentVoting && !completedVoting && (
        <button
          onClick={startVoting}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer'
          }}
        >
          Start Voting
        </button>
      )}

      {currentVoting && (
        <div>
          <p>Voting in progress...</p>
          <p>Time remaining: {timeRemaining}s</p>
          <p>Stand on a tile to cast your vote!</p>
          {!hasPlayerVoted() && (
            <button
              onClick={submitVote}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2196F3',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Submit Vote
            </button>
          )}
          <div style={{ marginTop: '10px' }}>
            <h4>Current Votes:</h4>
            <ul style={{ paddingLeft: '20px' }}>
              {getCurrentVotes().map((result, index) => (
                <li key={index}>
                  {result.name}: {result.vote}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {completedVoting && (
        <div>
          <h4>Final Result:</h4>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {completedVoting.result || 'No consensus'}
          </p>
          <button
            onClick={startVoting}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#2196F3',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            New Vote
          </button>
        </div>
      )}
    </div>
  );
};

export default VotingPanel;