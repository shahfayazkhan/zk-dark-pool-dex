package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"zk-dark-pool-dex/backend/engine"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow CORS for development
	},
}

// Client represents a connected user session
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

type Message struct {
	Type    string          `json:"type"`    // "submit_order", "get_book", "order_book_update", "match"
	Payload json.RawMessage `json:"payload"`
}

// Hub maintains active clients and broadcasts events
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	engine     *engine.MatchingEngine
	mu         sync.Mutex
}

func NewHub(me *engine.MatchingEngine) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		engine:     me,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Println("Client connected")
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Println("Client disconnected")
		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) BroadcastMatch(me *engine.MatchEvent) {
	payload, err := json.Marshal(me)
	if err != nil {
		log.Printf("Error marshalling match: %v", err)
		return
	}

	msg := Message{
		Type:    "match",
		Payload: payload,
	}

	rawMsg, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshalling message: %v", err)
		return
	}

	log.Printf("Broadcasting match event: Buy Commitment %s matched with Sell Commitment %s", me.BuyOrder.Commitment, me.SellOrder.Commitment)
	h.broadcast <- rawMsg
	
	// Also broadcast order book update
	h.BroadcastOrderBook(me.BuyOrder.Token, me.BuyOrder.QuoteToken)
}

func (h *Hub) BroadcastOrderBook(token, quoteToken string) {
	buys, sells := h.engine.GetOrderBook(token, quoteToken)

	// Create scrubbed books (only show commitments and side, hide exact price/amount for other players)
	type PublicOrder struct {
		ID         string `json:"id"`
		Side       string `json:"side"`
		Commitment string `json:"commitment"`
		Token      string `json:"token"`
		QuoteToken string `json:"quoteToken"`
		Timestamp  int64  `json:"timestamp"`
	}

	publicBuys := make([]PublicOrder, len(buys))
	for i, o := range buys {
		publicBuys[i] = PublicOrder{
			ID:         o.ID,
			Side:       o.Side,
			Commitment: o.Commitment,
			Token:      o.Token,
			QuoteToken: o.QuoteToken,
			Timestamp:  o.Timestamp.Unix(),
		}
	}

	publicSells := make([]PublicOrder, len(sells))
	for i, o := range sells {
		publicSells[i] = PublicOrder{
			ID:         o.ID,
			Side:       o.Side,
			Commitment: o.Commitment,
			Token:      o.Token,
			QuoteToken: o.QuoteToken,
			Timestamp:  o.Timestamp.Unix(),
		}
	}

	payloadData := map[string]interface{}{
		"token":      token,
		"quoteToken": quoteToken,
		"buys":       publicBuys,
		"sells":      publicSells,
	}

	payload, _ := json.Marshal(payloadData)
	msg := Message{
		Type:    "order_book_update",
		Payload: payload,
	}

	rawMsg, _ := json.Marshal(msg)
	h.broadcast <- rawMsg
}

// Client readPump pumps messages from the websocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			log.Printf("read error: %v", err)
			break
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("invalid json message: %v", err)
			continue
		}

		switch msg.Type {
		case "submit_order":
			var order engine.Order
			if err := json.Unmarshal(msg.Payload, &order); err != nil {
				log.Printf("invalid order payload: %v", err)
				continue
			}

			log.Printf("Received Order Commitment: %s (Side: %s, Price: %d, Amount: %d)", order.Commitment, order.Side, order.Price, order.Amount)
			c.hub.engine.AddOrder(&order)
			
			// Broadcast updated book
			c.hub.BroadcastOrderBook(order.Token, order.QuoteToken)

		case "get_book":
			var filter struct {
				Token      string `json:"token"`
				QuoteToken string `json:"quoteToken"`
			}
			if err := json.Unmarshal(msg.Payload, &filter); err != nil {
				log.Printf("invalid filter payload: %v", err)
				continue
			}
			c.hub.BroadcastOrderBook(filter.Token, filter.QuoteToken)
		}
	}
}

// Client writePump pumps messages from the hub to the websocket connection
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}
		}
	}
}

// ServeWs handles websocket requests from the client
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}
