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

  // Recursive timeout for countdown (prevents interval stacking)
  useEffect(() => {
    if (!votingActive || countdown <= 0) return;

    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, votingActive]);

  // Submit vote and end voting
  useEffect(() => {
    if (votingActive && countdown === 0 && !showResults) {
      console.log('[VotingPanel] Countdown reached 0. Attempting to submit vote...');
      
      if (localPlayer && conn) {
        console.log('[VotingPanel] Local player position:', localPlayer.position);
        const tileInfo = getTileInfo(localPlayer.position);
  
        if (tileInfo) {
          console.log('[VotingPanel] Tile found:', tileInfo);
          conn.reducers.submitVote(tileInfo.size);
        } else {
          console.warn('[VotingPanel] No tile matched player position!');
        }
      } else {
        console.warn('[VotingPanel] Missing localPlayer or conn, cannot submit vote.');
      }
      console.log('[VotingPanel] localPlayer:', localPlayer);
      console.log('[VotingPanel] conn:', conn);
  
      setShowResults(true);
      setVotingActive(false);
    }
  }, [votingActive, countdown, showResults, localPlayer, conn]);  

  const startVoting = () => {
    if (!conn) return;
    setVotingActive(true);
    setCountdown(10);
    setShowResults(false);
    conn.reducers.resetVotes();
  };

  const getTileInfo = (position: { x: number, z: number }) => {
    console.log('[TileInfo] Checking position:', position);
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
        console.log(`[TileInfo] Match found: ${tile.size}`);
        return tile;
      }
    }
  
    console.warn('[TileInfo] No matching tile found');
    return null;
  };  

  const allPlayersVoted = Array.from(players.values()).every(p => p.hasVoted);
  const votingResults = Array.from(players.values())
    .filter(p => p.hasVoted)
    .sort((a, b) => a.username.localeCompare(b.username))
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
      minWidth: '200px',
      zIndex: 10
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
          {!localPlayer?.hasVoted && (
            <p style={{ color: 'orange' }}>You haven't voted yet!</p>
          )}
        </div>
      )}

      {(showResults || allPlayersVoted) && (
        <div>
          <h4>Voting Results:</h4>
          <ul style={{ paddingLeft: '20px' }}>
            {votingResults.map((result, index) => (
              <li key={index}>
                {result.name}: {result.vote || '?'}
              </li>
            ))}
          </ul>
          <button
            onClick={startVoting}
            disabled={votingActive}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#2196F3',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: votingActive ? 'not-allowed' : 'pointer',
              opacity: votingActive ? 0.5 : 1
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