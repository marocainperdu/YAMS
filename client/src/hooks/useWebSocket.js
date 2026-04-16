import { useEffect, useReducer, useCallback, useRef } from 'react';

/**
 * WebSocket state reducer
 */
function wsReducer(state, action) {
  switch (action.type) {
    case 'CONNECT':
      return { ...state, isConnected: true, reconnectAttempt: 0 };
    case 'DISCONNECT':
      return { ...state, isConnected: false };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'ADD_LOG':
      return {
        ...state,
        logs: {
          ...state.logs,
          [action.payload.serverId]: [
            ...(state.logs[action.payload.serverId] || []),
            action.payload.log
          ]
        }
      };
    case 'CLEAR_LOGS':
      return {
        ...state,
        logs: { ...state.logs, [action.payload]: [] }
      };
    case 'SET_STATUS':
      return {
        ...state,
        serverStatus: {
          ...state.serverStatus,
          [action.payload.serverId]: action.payload.status
        }
      };
    case 'REPLACE_LOGS':
      return {
        ...state,
        logs: {
          ...state.logs,
          [action.payload.serverId]: action.payload.logs
        }
      };
    default:
      return state;
  }
}

/**
 * WebSocket connection manager hook with auto-reconnect
 */
export default function useWebSocket() {
  const [state, dispatch] = useReducer(wsReducer, {
    isConnected: false,
    error: null,
    logs: {},
    serverStatus: {},
    reconnectAttempt: 0
  });

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const subscribedServerRef = useRef(null);
  const messageQueueRef = useRef([]);

  /**
   * Initialize WebSocket connection
   */
  useEffect(() => {
    const connect = () => {
      try {
        const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
        const ws = new WebSocket(wsUrl);

        ws.addEventListener('open', () => {
          console.log('[WS] Connected');
          dispatch({ type: 'CONNECT' });
          dispatch({ type: 'CLEAR_ERROR' });

          // Resubscribe to previous server if any
          if (subscribedServerRef.current) {
            ws.send(
              JSON.stringify({
                action: 'subscribe',
                serverId: subscribedServerRef.current
              })
            );
          }

          // Send queued messages
          while (messageQueueRef.current.length > 0) {
            const msg = messageQueueRef.current.shift();
            ws.send(JSON.stringify(msg));
          }
        });

        ws.addEventListener('message', (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'history') {
              // Replay log history
              dispatch({
                type: 'REPLACE_LOGS',
                payload: {
                  serverId: msg.serverId,
                  logs: msg.logs || []
                }
              });
            } else if (msg.type === 'status') {
              dispatch({
                type: 'SET_STATUS',
                payload: {
                  serverId: msg.serverId,
                  status: msg.data
                }
              });
            } else if (msg.type === 'stdout' || msg.type === 'stderr') {
              dispatch({
                type: 'ADD_LOG',
                payload: {
                  serverId: msg.serverId,
                  log: {
                    type: msg.type,
                    data: msg.data,
                    timestamp: msg.timestamp
                  }
                }
              });
            } else if (msg.type === 'error') {
              dispatch({ type: 'SET_ERROR', payload: `Server error: ${msg.code}` });
            }
          } catch (err) {
            console.error('[WS] Parse error:', err);
          }
        });

        ws.addEventListener('close', () => {
          console.log('[WS] Disconnected');
          dispatch({ type: 'DISCONNECT' });
          wsRef.current = null;

          // Exponential backoff reconnection (1s, 2s, 4s, 8s, 30s max)
          const backoffMs = Math.min(1000 * Math.pow(2, state.reconnectAttempt), 30000);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[WS] Attempting reconnection...');
            connect();
          }, backoffMs);
        });

        ws.addEventListener('error', (err) => {
          console.error('[WS] Error:', err);
          dispatch({
            type: 'SET_ERROR',
            payload: 'WebSocket connection failed'
          });
        });

        wsRef.current = ws;
      } catch (err) {
        console.error('[WS] Connection error:', err);
        dispatch({ type: 'SET_ERROR', payload: 'Failed to connect to WebSocket' });
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [state.reconnectAttempt]);

  /**
   * Subscribe to a server
   */
  const subscribe = useCallback((serverId) => {
    if (!serverId) return;

    subscribedServerRef.current = serverId;
    dispatch({ type: 'CLEAR_LOGS', payload: serverId });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'subscribe',
          serverId
        })
      );
    } else {
      messageQueueRef.current.push({
        action: 'subscribe',
        serverId
      });
    }
  }, []);

  /**
   * Unsubscribe from a server
   */
  const unsubscribe = useCallback((serverId) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'unsubscribe',
          serverId
        })
      );
    }
  }, []);

  /**
   * Send command to server
   */
  const sendCommand = useCallback((serverId, command) => {
    if (!command.trim() || !serverId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'command',
          serverId,
          data: command
        })
      );
    } else {
      messageQueueRef.current.push({
        action: 'command',
        serverId,
        data: command
      });
      dispatch({
        type: 'SET_ERROR',
        payload: 'WebSocket not connected — command will be sent when reconnected'
      });
    }
  }, []);

  return {
    isConnected: state.isConnected,
    subscribe,
    unsubscribe,
    sendCommand,
    logs: state.logs,
    serverStatus: state.serverStatus,
    error: state.error
  };
}
