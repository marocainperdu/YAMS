/**
 * Low-level WebSocket service wrapper
 * Provides basic connection management and message handling
 * No reconnection logic here - that's in the useWebSocket hook
 */

export class WSService {
  /** @type {WebSocket | null} */
  ws = null;

  /** @type {Map<string, Function>} Event listeners */
  listeners = new Map();

  /** @type {number} Message ID counter for tracking */
  messageId = 0;

  /**
   * Connect to WebSocket server
   * @param {string} url - WebSocket URL (e.g., ws://localhost:3001)
   * @returns {Promise<void>}
   */
  connect(url) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.emit('connect');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.emit('message', message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error, event.data);
            this.emit('error', { message: 'Invalid message format', error });
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', { message: 'WebSocket error', error });
          reject(error);
        };

        this.ws.onclose = () => {
          this.emit('disconnect');
        };
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * Send a message over WebSocket
   * @param {object} message - Message to send
   * @returns {boolean} - Success status
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      return false;
    }
  }

  /**
   * Close WebSocket connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Register event listener
   * @param {string} event - Event name
   * @param {Function} handler - Callback function
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} handler - Callback function
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners
   * @param {string} event - Event name
   * @param {any} data - Event data
   * @private
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      });
    }
  }
}

// Singleton instance
let wsServiceInstance = null;

/**
 * Get or create WebSocket service singleton
 * @returns {WSService}
 */
export function getWSService() {
  if (!wsServiceInstance) {
    wsServiceInstance = new WSService();
  }
  return wsServiceInstance;
}
