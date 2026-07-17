package engine

import (
	"crypto/rand"
	"math/big"
	"sort"
	"sync"
	"time"
)

type Order struct {
	ID         string    `json:"id"`
	ClientAddr string    `json:"clientAddr"` // EVM address of order owner
	Side       string    `json:"side"`       // "buy" or "sell"
	Token      string    `json:"token"`      // Base token address
	QuoteToken string    `json:"quoteToken"` // Quote token address
	Price      uint64    `json:"price"`      // Price (limit)
	Amount     uint64    `json:"amount"`     // Amount (limit)
	Nonce      string    `json:"nonce"`      // Cryptographic nonce (as string to fit Poseidon hex/uint256)
	Commitment string    `json:"commitment"` // Poseidon hash of (price, amount, nonce)
	Timestamp  time.Time `json:"timestamp"`
}

type MatchEvent struct {
	ID          string `json:"id"`
	BuyOrder    *Order `json:"buyOrder"`
	SellOrder   *Order `json:"sellOrder"`
	MatchPrice  uint64 `json:"matchPrice"`
	MatchAmount uint64 `json:"matchAmount"`
	Timestamp   int64  `json:"timestamp"`
}

type MatchingEngine struct {
	mu        sync.Mutex
	buyBooks  map[string][]*Order // token_quoteToken -> buy orders
	sellBooks map[string][]*Order // token_quoteToken -> sell orders
	matches   []*MatchEvent
	onMatch   func(*MatchEvent) // Callback when match occurs
}

func NewMatchingEngine(onMatch func(*MatchEvent)) *MatchingEngine {
	return &MatchingEngine{
		buyBooks:  make(map[string][]*Order),
		sellBooks: make(map[string][]*Order),
		matches:   make([]*MatchEvent, 0),
		onMatch:   onMatch,
	}
}

// GenerateRandomID creates a cryptographic unique ID
func GenerateRandomID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return big.NewInt(0).SetBytes(b).Text(16)
}

func getBookKey(token, quoteToken string) string {
	return token + "_" + quoteToken
}

// AddOrder inserts an order and returns matching events if a match occurs
func (me *MatchingEngine) AddOrder(order *Order) {
	me.mu.Lock()
	defer me.mu.Unlock()

	order.Timestamp = time.Now()
	if order.ID == "" {
		order.ID = GenerateRandomID()
	}

	key := getBookKey(order.Token, order.QuoteToken)

	if order.Side == "buy" {
		me.buyBooks[key] = append(me.buyBooks[key], order)
		// Sort buy orders descending (highest price first, then oldest)
		sort.Slice(me.buyBooks[key], func(i, j int) bool {
			if me.buyBooks[key][i].Price == me.buyBooks[key][j].Price {
				return me.buyBooks[key][i].Timestamp.Before(me.buyBooks[key][j].Timestamp)
			}
			return me.buyBooks[key][i].Price > me.buyBooks[key][j].Price
		})
	} else {
		me.sellBooks[key] = append(me.sellBooks[key], order)
		// Sort sell orders ascending (lowest price first, then oldest)
		sort.Slice(me.sellBooks[key], func(i, j int) bool {
			if me.sellBooks[key][i].Price == me.sellBooks[key][j].Price {
				return me.sellBooks[key][i].Timestamp.Before(me.sellBooks[key][j].Timestamp)
			}
			return me.sellBooks[key][i].Price < me.sellBooks[key][j].Price
		})
	}

	// Try matching
	me.match(key)
}

func (me *MatchingEngine) match(key string) {
	buys := me.buyBooks[key]
	sells := me.sellBooks[key]

	if len(buys) == 0 || len(sells) == 0 {
		return
	}

	// Index pointers
	buyIdx := 0
	sellIdx := 0

	var updatedBuys []*Order
	var updatedSells []*Order

	// Copy unmatched parts
	matchedBuys := make(map[string]bool)
	matchedSells := make(map[string]bool)

	for buyIdx < len(buys) && sellIdx < len(sells) {
		buy := buys[buyIdx]
		sell := sells[sellIdx]

		// Check if prices cross
		if buy.Price >= sell.Price {
			// Determine execution price (maker's price: whichever came first)
			var matchPrice uint64
			if buy.Timestamp.Before(sell.Timestamp) {
				matchPrice = buy.Price
			} else {
				matchPrice = sell.Price
			}

			// Match amount is min of both
			matchAmount := buy.Amount
			if sell.Amount < buy.Amount {
				matchAmount = sell.Amount
			}

			// In a dark pool, commitments are signed for full amounts.
			// For this ZK-DEX demonstration, we assume orders match fully.
			// If partial matches occur, we remove the filled orders from the active list.
			// We trigger a match event
			matchEvent := &MatchEvent{
				ID:          GenerateRandomID(),
				BuyOrder:    buy,
				SellOrder:   sell,
				MatchPrice:  matchPrice,
				MatchAmount: matchAmount,
				Timestamp:   time.Now().Unix(),
			}

			me.matches = append(me.matches, matchEvent)
			matchedBuys[buy.ID] = true
			matchedSells[sell.ID] = true

			// Invoke callback to notify WebSocket clients
			if me.onMatch != nil {
				me.onMatch(matchEvent)
			}

			// Move past these matched orders
			buyIdx++
			sellIdx++
		} else {
			// Prices do not cross, no further matches possible since books are sorted
			break
		}
	}

	// Rebuild active order book lists, keeping only unmatched orders
	for _, b := range buys {
		if !matchedBuys[b.ID] {
			updatedBuys = append(updatedBuys, b)
		}
	}
	for _, s := range sells {
		if !matchedSells[s.ID] {
			updatedSells = append(updatedSells, s)
		}
	}

	me.buyBooks[key] = updatedBuys
	me.sellBooks[key] = updatedSells
}

// GetOrderBook returns the current state of active orders (with private details hidden in production if needed)
func (me *MatchingEngine) GetOrderBook(token, quoteToken string) ([]*Order, []*Order) {
	me.mu.Lock()
	defer me.mu.Unlock()

	key := getBookKey(token, quoteToken)
	buys := append([]*Order(nil), me.buyBooks[key]...)
	sells := append([]*Order(nil), me.sellBooks[key]...)

	return buys, sells
}

// GetMatches returns list of all executed matches
func (me *MatchingEngine) GetMatches() []*MatchEvent {
	me.mu.Lock()
	defer me.mu.Unlock()
	return me.matches
}
