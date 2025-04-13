import React, { useState, useEffect } from 'react';
import { PlayerData, DbConnection } from '../generated';

interface VotingPanelProps {
  localPlayer: PlayerData | null;
  players: Map<string, PlayerData>;
  conn: DbConnection | null;
}

export const VotingPanel: React.FC<VotingPanelProps> = ({ localPlayer, players, conn }) => {
  const [votingActive, setVotingActive] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (votingActive && countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    } else if (countdown === 0) {
      if (localPlayer && conn) {
        const tileInfo = getTileInfo(localPlayer.position);
        if (tileInfo) {
          conn.reducers.submitVote(tileInfo.size);
        }
      }
      setShowResults(true);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [votingActive, countdown, localPlayer, conn]);

  const startVoting = () => {
    if (!conn) return;
    setVotingActive(true);
    setCountdown(10);
    setShowResults(false);
    conn.reducers.resetVotes();
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

  const allPlayersVoted = Array.from(players.values()).every(p => p.hasVoted);
  const votingResults = Array.from(players.values())
    .filter(p => p.hasVoted)
    .map(p => ({ name: p.username, vote: p.currentVote }));

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: '20px',
      borderRadius: '8px',
      color: 'white',
      minWidth: '200px'
    }}>
      <h3>Scrum Poker</h3>
      
      {!votingActive && !showResults && (
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

      {votingActive && countdown > 0 && (
        <div>
          <p>Voting in progress...</p>
          <p>Time remaining: {countdown}s</p>
          <p>Stand on a tile to cast your vote!</p>
        </div>
      )}

      {(showResults || allPlayersVoted) && (
        <div>
          <h4>Voting Results:</h4>
          {votingResults.map((result, index) => (
            <div key={index}>
              {result.name}: {result.vote || '?'}
            </div>
          ))}
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