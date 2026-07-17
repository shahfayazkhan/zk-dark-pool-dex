package main

import (
	"encoding/json"
	"log"
	"net/http"
	"zk-dark-pool-dex/backend/engine"
	"zk-dark-pool-dex/backend/server"
)

func main() {
	log.Println("Starting ZK-Dark Pool DEX Backend Server...")

	// 1. Initialize variables
	var hub *server.Hub

	// 2. Initialize matching engine with a match event handler
	me := engine.NewMatchingEngine(func(match *engine.MatchEvent) {
		if hub != nil {
			hub.BroadcastMatch(match)
		}
	})

	// 3. Initialize WebSocket Hub
	hub = server.NewHub(me)
	go hub.Run()

	// 4. Setup HTTP and WebSocket routes with CORS support
	mux := http.NewServeMux()

	// WebSocket handler
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		server.ServeWs(hub, w, r)
	})

	// REST API to query current matches (for trade history)
	mux.HandleFunc("/api/matches", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		matches := me.GetMatches()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(matches)
	})

	// REST API to query active order books
	mux.HandleFunc("/api/orders", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == "OPTIONS" {
			return
		}
		token := r.URL.Query().Get("token")
		quoteToken := r.URL.Query().Get("quoteToken")
		if token == "" || quoteToken == "" {
			http.Error(w, "Missing token or quoteToken query parameters", http.StatusBadRequest)
			return
		}
		buys, sells := me.GetOrderBook(token, quoteToken)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"buys":  buys,
			"sells": sells,
		})
	})

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Bind CORS wrapper to the server
	port := ":8080"
	log.Printf("Server listening on http://localhost%s", port)
	if err := http.ListenAndServe(port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}
