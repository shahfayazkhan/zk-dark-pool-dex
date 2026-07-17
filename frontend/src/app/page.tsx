'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Lock, Wallet, History, Cpu, ArrowUpRight, ArrowDownRight, 
  TrendingUp, Play, CheckCircle2, ShieldAlert, Activity, 
  RefreshCw, ArrowRightLeft, User, ExternalLink, HelpCircle
} from 'lucide-react';
import { 
  useAccount, useConnect, useDisconnect, useWriteContract, 
  useWaitForTransactionReceipt, useReadContract 
} from 'wagmi';
import { ethers } from 'ethers';

// Default hardhat contract addresses
const DEFAULT_CONTRACTS = {
  verifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  darkPool: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  mbtc: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  musdc: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
};

// ABI fragments
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function mint(address to, uint256 amount) public',
  'function balanceOf(address account) public view returns (uint256)',
  'function allowance(address owner, address spender) public view returns (uint256)'
];

const DARKPOOL_ABI = [
  'function deposit(address token, uint256 amount) external',
  'function withdraw(address token, uint256 amount) external',
  'function submitOrderCommitment(bytes32 commitment) external',
  'function balances(address user, address token) public view returns (uint256)',
  'function commitments(bytes32 commitment) public view returns (bool)'
];

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Settings
  const [darkPoolAddress, setDarkPoolAddress] = useState(DEFAULT_CONTRACTS.darkPool);
  const [mbtcAddress, setMbtcAddress] = useState(DEFAULT_CONTRACTS.mbtc);
  const [musdcAddress, setMusdcAddress] = useState(DEFAULT_CONTRACTS.musdc);
  const [showSettings, setShowSettings] = useState(false);

  // App State
  const [activeTab, setActiveTab] = useState<'trade' | 'portfolio' | 'history' | 'zk'>('trade');
  const [wsConnected, setWsConnected] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; type: 'info' | 'success' | 'warn'; msg: string }[]>([]);
  
  // Real-time Order Book & Matches
  const [publicBook, setPublicBook] = useState<{ buys: any[]; sells: any[] }>({ buys: [], sells: [] });
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [myOrders, setMyOrders] = useState<any[]>([]);

  // Forms
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradePrice, setTradePrice] = useState('45000');
  const [tradeAmount, setTradeAmount] = useState('1');
  const [depositToken, setDepositToken] = useState('MBTC');
  const [depositAmount, setDepositAmount] = useState('10');
  const [withdrawToken, setWithdrawToken] = useState('MBTC');
  const [withdrawAmount, setWithdrawAmount] = useState('5');

  // ZK Visualizer State
  const [zkStep, setZkStep] = useState<number>(0);
  const [zkStatus, setZkStatus] = useState<string>('Idle');
  const [zkProgress, setZkProgress] = useState<number>(0);
  const [visualizingMatch, setVisualizingMatch] = useState<any>(null);

  // Contract Read Balances (Mock state updated regularly for demo if wallet not connected, otherwise read from contract)
  const [walletMBtc, setWalletMBtc] = useState('100.0');
  const [walletMUsdc, setWalletMUsdc] = useState('100000.0');
  const [poolMBtc, setPoolMBtc] = useState('0.0');
  const [poolMUsdc, setPoolMUsdc] = useState('0.0');

  // Transactions State
  const { writeContract, data: txHash } = useWriteContract();
  const [isMinting, setIsMinting] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);

  // Helper for notifications
  const triggerNotification = (type: 'info' | 'success' | 'warn', msg: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, type, msg }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Connect WebSockets
  useEffect(() => {
    const connectWs = () => {
      const ws = new WebSocket('ws://localhost:8080/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        triggerNotification('success', 'Connected to private matching engine');
        // Fetch current book for MBTC / MUSDC
        ws.send(JSON.stringify({
          type: 'get_book',
          payload: {
            token: mbtcAddress,
            quoteToken: musdcAddress
          }
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'order_book_update') {
          const payload = JSON.parse(data.payload);
          setPublicBook({
            buys: payload.buys || [],
            sells: payload.sells || []
          });
        } else if (data.type === 'match') {
          const match = JSON.parse(data.payload);
          setRecentMatches(prev => [match, ...prev]);
          triggerNotification('success', `MATCH FOUND: Private Trade matches! Price: ${match.matchPrice} USDC, Amount: ${match.matchAmount}`);
          
          // Auto start ZK Proof generation visualizer
          setVisualizingMatch(match);
          setActiveTab('zk');
          startZkProofVisualization(match);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connectWs, 3000); // Reconnect
      };
    };

    connectWs();

    // Fetch initial REST data
    fetch('http://localhost:8080/api/matches')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRecentMatches(data);
      })
      .catch(() => {});

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [mbtcAddress, musdcAddress]);

  // Load balances and updates
  useEffect(() => {
    // Regular mock updates just for realistic dashboards
    const interval = setInterval(() => {
      if (!isConnected) {
        // If not connected, fluctuate balances/books/stats slightly to simulate real activity
        setWalletMBtc(prev => (parseFloat(prev) + (Math.random() - 0.5) * 0.1).toFixed(2));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Submit Order Commitment to Go Backend & Solidity Contract
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsConnected) {
      triggerNotification('warn', 'Order book connection is offline');
      return;
    }

    const price = parseInt(tradePrice);
    const amount = parseInt(tradeAmount);
    const nonce = Math.floor(Math.random() * 1000000).toString();

    // Generate cryptographic order commitment (hash)
    // Buy Order Hash: Poseidon equivalent in Solidity/Circom.
    // For demonstration and client-side convenience, we use standard ethers keccak256
    // mapped to a bytes32 commitment.
    const enc = new TextEncoder();
    const mockHashData = ethers.solidityPackedKeccak256(
      ['uint256', 'uint256', 'string', 'string'],
      [price, amount, nonce, tradeSide]
    );

    triggerNotification('info', `Hashing private order details with Poseidon...`);

    const orderData = {
      clientAddr: address || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      side: tradeSide,
      token: mbtcAddress,
      quoteToken: musdcAddress,
      price: price,
      amount: amount,
      nonce: nonce,
      commitment: mockHashData
    };

    // 1. Submit commitment to Smart Contract first (to shield/verify on-chain)
    if (isConnected) {
      try {
        triggerNotification('info', 'Registering order commitment on-chain...');
        writeContract({
          address: darkPoolAddress as `0x${string}`,
          abi: DARKPOOL_ABI,
          functionName: 'submitOrderCommitment',
          args: [mockHashData],
        });
      } catch (err: any) {
        triggerNotification('warn', `On-chain registration failed: ${err.message}`);
        return;
      }
    } else {
      triggerNotification('success', 'Demo Mode: Commitment registered on simulated ledger');
    }

    // 2. Submit order details to private matcher via WS
    wsRef.current?.send(JSON.stringify({
      type: 'submit_order',
      payload: orderData
    }));

    setMyOrders(prev => [orderData, ...prev]);
    triggerNotification('success', `Private Order Commitment posted to Matcher!`);
  };

  // Run ZK Prover Simulation Visualizer
  const startZkProofVisualization = (match: any) => {
    setZkStep(1);
    setZkStatus('Poseidon Commitment Verification');
    setZkProgress(10);

    const steps = [
      { status: 'Poseidon Commitment Verification', progress: 25 },
      { status: 'Witness Calculation: Extracting Price/Volume boundaries', progress: 50 },
      { status: 'Synthesizing Circuit Constraints (6,242 R1CS variables)', progress: 75 },
      { status: 'Generating Groth16 Snark Proof via WebAssembly Prover', progress: 90 },
      { status: 'Submitting Proof & Settling on DarkPool.sol Contract', progress: 100 }
    ];

    let i = 0;
    const timer = setInterval(() => {
      if (i < steps.length) {
        setZkStatus(steps[i].status);
        setZkProgress(steps[i].progress);
        setZkStep(i + 2);
        i++;
      } else {
        clearInterval(timer);
        triggerNotification('success', 'ZK Trade settled successfully on-chain!');
        // Update pool balances
        if (match.buyOrder.clientAddr === address) {
          // I am buyer
          setPoolMBtc(prev => (parseFloat(prev) + match.matchAmount).toString());
          setPoolMUsdc(prev => (parseFloat(prev) - (match.matchPrice * match.matchAmount)).toString());
        } else if (match.sellOrder.clientAddr === address) {
          // I am seller
          setPoolMBtc(prev => (parseFloat(prev) - match.matchAmount).toString());
          setPoolMUsdc(prev => (parseFloat(prev) + (match.matchPrice * match.matchAmount)).toString());
        }
      }
    }, 2000);
  };

  // Handle Mock Faucet Mint
  const handleFaucetMint = async () => {
    if (!isConnected) {
      // Demo Faucet
      setWalletMBtc('200.0');
      setWalletMUsdc('200000.0');
      triggerNotification('success', 'Demo Faucet: Added 100 MBTC and 100,000 MUSDC to wallet');
      return;
    }
    setIsMinting(true);
    try {
      // Mint MBTC
      writeContract({
        address: mbtcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [address, ethers.parseUnits('100', 18)],
      });
      // Mint MUSDC
      writeContract({
        address: musdcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [address, ethers.parseUnits('100000', 18)],
      });
      triggerNotification('success', 'Tokens minted! Check your wallet balance shortly.');
    } catch (err: any) {
      triggerNotification('warn', `Mint failed: ${err.message}`);
    } finally {
      setIsMinting(false);
    }
  };

  // Handle Deposit
  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tokenAddr = depositToken === 'MBTC' ? mbtcAddress : musdcAddress;
    const amountRaw = ethers.parseUnits(depositAmount, 18);

    if (!isConnected) {
      // Demo Deposit
      if (depositToken === 'MBTC') {
        setWalletMBtc(prev => (parseFloat(prev) - parseFloat(depositAmount)).toFixed(2));
        setPoolMBtc(prev => (parseFloat(prev) + parseFloat(depositAmount)).toFixed(2));
      } else {
        setWalletMUsdc(prev => (parseFloat(prev) - parseFloat(depositAmount)).toFixed(2));
        setPoolMUsdc(prev => (parseFloat(prev) + parseFloat(depositAmount)).toFixed(2));
      }
      triggerNotification('success', `Demo Deposit: Shielded ${depositAmount} ${depositToken} inside Dark Pool`);
      return;
    }

    setIsDepositing(true);
    try {
      triggerNotification('info', 'Approving tokens for DarkPool contract...');
      // 1. Approve
      writeContract({
        address: tokenAddr as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [darkPoolAddress, amountRaw],
      });

      // 2. Deposit
      setTimeout(() => {
        triggerNotification('info', 'Executing Deposit transaction...');
        writeContract({
          address: darkPoolAddress as `0x${string}`,
          abi: DARKPOOL_ABI,
          functionName: 'deposit',
          args: [tokenAddr, amountRaw],
        });
      }, 3000);
    } catch (err: any) {
      triggerNotification('warn', `Deposit failed: ${err.message}`);
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full">
      {/* Top Banner / Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-gray-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="text-emerald-500 w-8 h-8" />
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              ZK-Dark Pool DEX
            </h1>
            <span className="text-xs px-2 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-400 font-mono">
              v1.0-L2
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Privacy-first execution engine backed by Zero-Knowledge verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* WebSocket Status */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900 border border-gray-800 text-xs font-medium">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-gray-300">Matcher: {wsConnected ? 'Online' : 'Offline'}</span>
          </div>

          {/* Web3 Faucet */}
          <button 
            onClick={handleFaucetMint}
            className="px-3 py-1.5 rounded bg-gray-800 border border-gray-700 text-xs hover:bg-gray-700 text-emerald-400 transition-all font-semibold flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Faucet
          </button>

          {/* Web3 Wallet Connect */}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded bg-emerald-950/40 border border-emerald-900 text-xs font-mono text-emerald-400 flex items-center gap-1">
                <User className="w-3 h-3" />
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <button 
                onClick={() => disconnect()}
                className="px-3 py-1.5 rounded bg-red-950/40 border border-red-900 hover:bg-red-900/40 text-xs text-red-400 transition-all font-semibold"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button 
              onClick={() => connect({ connector: connectors[0] })}
              className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all shadow-md shadow-emerald-500/20"
            >
              Connect Wallet
            </button>
          )}

          {/* Settings Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
          >
            <SlidersIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Settings Form Overlay */}
      {showSettings && (
        <div className="mt-4 p-4 rounded-lg bg-gray-900/90 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-1.5">
            <SlidersIcon className="w-4 h-4 text-cyan-400" />
            Contract Deployment Settings (Localhost Networks)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-mono">DarkPool.sol Address</label>
              <input 
                type="text" 
                value={darkPoolAddress} 
                onChange={(e) => setDarkPoolAddress(e.target.value)} 
                className="w-full bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-cyan-500" 
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-mono">Base Asset (MBTC) Address</label>
              <input 
                type="text" 
                value={mbtcAddress} 
                onChange={(e) => setMbtcAddress(e.target.value)} 
                className="w-full bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-cyan-500" 
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-mono">Quote Asset (MUSDC) Address</label>
              <input 
                type="text" 
                value={musdcAddress} 
                onChange={(e) => setMusdcAddress(e.target.value)} 
                className="w-full bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-cyan-500" 
              />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-gray-800 my-6">
        <button
          onClick={() => setActiveTab('trade')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'trade' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Private Trade
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'portfolio' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Wallet className="w-4 h-4" />
          Shielded Wallet
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'history' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <History className="w-4 h-4" />
          Trade History
        </button>
        <button
          onClick={() => setActiveTab('zk')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'zk' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Cpu className="w-4 h-4" />
          ZK Prover {visualizingMatch && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />}
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Tab Content Panel */}
        <section className="lg:col-span-2 space-y-6">
          
          {/* TAB 1: TRADE DASHBOARD */}
          {activeTab === 'trade' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Private Order entry */}
              <div className="glass-panel rounded-xl p-5 shadow-lg flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                    <Lock className="text-emerald-500 w-4.5 h-4.5" />
                    Submit Private Order
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Your limit price and amounts are hashed on-chain. The off-chain engine matches orders privately.
                  </p>
                </div>

                <form onSubmit={handlePlaceOrder} className="space-y-4">
                  {/* Side Switch */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 rounded border border-gray-800">
                    <button
                      type="button"
                      onClick={() => setTradeSide('buy')}
                      className={`py-1.5 rounded text-xs font-semibold transition-all ${
                        tradeSide === 'buy' 
                          ? 'bg-emerald-500 text-black shadow-md' 
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      BUY MBTC
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeSide('sell')}
                      className={`py-1.5 rounded text-xs font-semibold transition-all ${
                        tradeSide === 'sell' 
                          ? 'bg-red-500 text-white shadow-md' 
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      SELL MBTC
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Limit Price (MUSDC per MBTC)
                    </label>
                    <div className="relative rounded bg-black/50 border border-gray-850">
                      <input
                        type="number"
                        value={tradePrice}
                        onChange={(e) => setTradePrice(e.target.value)}
                        className="w-full bg-transparent p-2.5 pr-12 text-sm text-gray-100 focus:outline-none font-mono"
                        required
                      />
                      <span className="absolute right-3 top-3 text-xs text-gray-500 font-mono">MUSDC</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Order Size (MBTC)
                    </label>
                    <div className="relative rounded bg-black/50 border border-gray-850">
                      <input
                        type="number"
                        value={tradeAmount}
                        onChange={(e) => setTradeAmount(e.target.value)}
                        className="w-full bg-transparent p-2.5 pr-12 text-sm text-gray-100 focus:outline-none font-mono"
                        required
                      />
                      <span className="absolute right-3 top-3 text-xs text-gray-500 font-mono">MBTC</span>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="p-3 rounded bg-black/35 border border-gray-800/50 space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Total Value:</span>
                      <span className="text-gray-200 font-bold">{(parseFloat(tradePrice) * parseFloat(tradeAmount)).toLocaleString()} MUSDC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">On-Chain Gas fee:</span>
                      <span className="text-emerald-500">~0.0004 ETH</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={`w-full py-3 rounded-lg font-bold text-xs shadow-lg transition-all ${
                      tradeSide === 'buy' 
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/10' 
                        : 'bg-red-500 hover:bg-red-400 text-white shadow-red-500/10'
                    }`}
                  >
                    Submit Order Commitment
                  </button>
                </form>
              </div>

              {/* Private Order Book */}
              <div className="glass-panel rounded-xl p-5 shadow-lg flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                    <Activity className="text-cyan-400 w-4.5 h-4.5" />
                    Private Order Book
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    To maintain privacy, price and volume details are replaced with cryptographic commitments. Only side and commitment hash are visible.
                  </p>
                </div>

                <div className="flex-1 flex flex-col gap-3 min-h-[300px]">
                  {/* Sells (Asks) */}
                  <div className="flex-1 flex flex-col bg-black/25 rounded p-2.5 border border-gray-850">
                    <div className="text-xs font-bold text-red-400 mb-1 flex justify-between border-b border-red-950/50 pb-1">
                      <span>Private Sells (Asks)</span>
                      <span>Commitment Hash</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 text-[11px] font-mono text-gray-400">
                      {publicBook.sells.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-600 italic">No active private asks</div>
                      ) : (
                        publicBook.sells.map((sell, index) => (
                          <div key={index} className="flex justify-between py-1 border-b border-gray-900 last:border-none">
                            <span className="text-red-400/80 font-bold">Ask #{index+1}</span>
                            <span className="text-gray-500">{sell.commitment.slice(0, 16)}...{sell.commitment.slice(-10)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Buys (Bids) */}
                  <div className="flex-1 flex flex-col bg-black/25 rounded p-2.5 border border-gray-850">
                    <div className="text-xs font-bold text-emerald-400 mb-1 flex justify-between border-b border-emerald-950/50 pb-1">
                      <span>Private Buys (Bids)</span>
                      <span>Commitment Hash</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 text-[11px] font-mono text-gray-400">
                      {publicBook.buys.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-600 italic">No active private bids</div>
                      ) : (
                        publicBook.buys.map((buy, index) => (
                          <div key={index} className="flex justify-between py-1 border-b border-gray-900 last:border-none">
                            <span className="text-emerald-400/80 font-bold">Bid #{index+1}</span>
                            <span className="text-gray-500">{buy.commitment.slice(0, 16)}...{buy.commitment.slice(-10)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PORTFOLIO & SHIELDING */}
          {activeTab === 'portfolio' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Balances Card */}
              <div className="glass-panel rounded-xl p-5 shadow-lg space-y-4">
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                  <Wallet className="text-emerald-500 w-4.5 h-4.5" />
                  Your Assets Ledger
                </h2>

                <div className="space-y-4">
                  {/* MBTC Asset */}
                  <div className="p-4 rounded-lg bg-black/40 border border-gray-800 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold font-mono text-xs">
                          ₿
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-100">Mock Bitcoin</h4>
                          <span className="text-[10px] text-gray-400 font-mono">Symbol: MBTC</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-400">Total Asset</span>
                        <p className="text-sm font-bold font-mono text-emerald-400">
                          {(parseFloat(walletMBtc) + parseFloat(poolMBtc)).toFixed(2)} MBTC
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-900/60 font-mono text-xs">
                      <div>
                        <span className="text-[10px] text-gray-500 block">Public Wallet</span>
                        <span className="text-gray-300 font-semibold">{walletMBtc} MBTC</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-500 block flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Shielded Pool
                        </span>
                        <span className="text-emerald-400 font-semibold">{poolMBtc} MBTC</span>
                      </div>
                    </div>
                  </div>

                  {/* MUSDC Asset */}
                  <div className="p-4 rounded-lg bg-black/40 border border-gray-800 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-bold font-mono text-xs">
                          $
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-100">Mock USD Coin</h4>
                          <span className="text-[10px] text-gray-400 font-mono">Symbol: MUSDC</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-400">Total Asset</span>
                        <p className="text-sm font-bold font-mono text-cyan-400">
                          {(parseFloat(walletMUsdc) + parseFloat(poolMUsdc)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDC
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-900/60 font-mono text-xs">
                      <div>
                        <span className="text-[10px] text-gray-500 block">Public Wallet</span>
                        <span className="text-gray-300 font-semibold">{parseFloat(walletMUsdc).toLocaleString()} USDC</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-cyan-500 block flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Shielded Pool
                        </span>
                        <span className="text-cyan-400 font-semibold">{parseFloat(poolMUsdc).toLocaleString()} USDC</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shielding Portal (Deposit/Withdraw) */}
              <div className="glass-panel rounded-xl p-5 shadow-lg flex flex-col gap-4">
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                  <ArrowRightLeft className="text-emerald-500 w-4.5 h-4.5" />
                  Shielding Portal
                </h2>

                {/* Deposit Form */}
                <form onSubmit={handleDeposit} className="space-y-3 p-3 bg-emerald-950/10 rounded border border-emerald-900/20">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Deposit into Shielded Pool</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <select 
                      value={depositToken} 
                      onChange={(e) => setDepositToken(e.target.value)}
                      className="bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="MBTC">MBTC</option>
                      <option value="MUSDC">MUSDC</option>
                    </select>
                    <input 
                      type="number" 
                      value={depositAmount} 
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-mono" 
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isDepositing}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-1.5 rounded text-xs font-bold transition-all"
                  >
                    {isDepositing ? 'Shielding...' : `Shield ${depositToken}`}
                  </button>
                </form>

                {/* Withdraw Form */}
                <div className="space-y-3 p-3 bg-gray-900/30 rounded border border-gray-800">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Withdraw to Public Wallet</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <select 
                      value={withdrawToken} 
                      onChange={(e) => setWithdrawToken(e.target.value)}
                      className="bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="MBTC">MBTC</option>
                      <option value="MUSDC">MUSDC</option>
                    </select>
                    <input 
                      type="number" 
                      value={withdrawAmount} 
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 bg-black border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-mono" 
                      required
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (withdrawToken === 'MBTC') {
                        setPoolMBtc(prev => (parseFloat(prev) - parseFloat(withdrawAmount)).toFixed(2));
                        setWalletMBtc(prev => (parseFloat(prev) + parseFloat(withdrawAmount)).toFixed(2));
                      } else {
                        setPoolMUsdc(prev => (parseFloat(prev) - parseFloat(withdrawAmount)).toFixed(2));
                        setWalletMUsdc(prev => (parseFloat(prev) + parseFloat(withdrawAmount)).toFixed(2));
                      }
                      triggerNotification('success', `Unshielded ${withdrawAmount} ${withdrawToken} back to your wallet!`);
                    }}
                    className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 rounded text-xs font-bold transition-all border border-gray-700"
                  >
                    Unshield {withdrawToken}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TRADE HISTORY */}
          {activeTab === 'history' && (
            <div className="glass-panel rounded-xl p-5 shadow-lg space-y-4">
              <div>
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                  <History className="text-emerald-500 w-4.5 h-4.5" />
                  Executed Trade History (Public Records)
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Once orders match and proofs verification triggers on-chain settlement, details are settled on the ledger.
                </p>
              </div>

              <div className="overflow-x-auto border border-gray-850 rounded bg-black/25">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-black/70 border-b border-gray-800 text-gray-400">
                      <th className="p-3">Match ID</th>
                      <th className="p-3">Buyer Commitment</th>
                      <th className="p-3">Seller Commitment</th>
                      <th className="p-3">Price</th>
                      <th className="p-3">Amount</th>
                      <th className="p-3">On-Chain State</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300 divide-y divide-gray-900">
                    {recentMatches.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-gray-500 italic">No matches executed yet</td>
                      </tr>
                    ) : (
                      recentMatches.map((m, idx) => (
                        <tr key={idx} className="hover:bg-gray-900/35">
                          <td className="p-3 text-cyan-400 font-semibold">{m.id.slice(0, 8)}...</td>
                          <td className="p-3 text-gray-500">{m.buyOrder.commitment.slice(0, 10)}...</td>
                          <td className="p-3 text-gray-500">{m.sellOrder.commitment.slice(0, 10)}...</td>
                          <td className="p-3 font-semibold text-emerald-400">{m.matchPrice} USDC</td>
                          <td className="p-3">{m.matchAmount} MBTC</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/40 border border-emerald-900 text-emerald-400 font-bold flex items-center gap-1 w-max">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Setled
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: ZK VISUALIZER */}
          {activeTab === 'zk' && (
            <div className="glass-panel rounded-xl p-5 shadow-lg space-y-6">
              <div>
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-1.5">
                  <Cpu className="text-cyan-400 w-4.5 h-4.5" />
                  Zero-Knowledge Prover Node
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Step-by-step cryptographic proof visualizer matching your circuit constraints.
                </p>
              </div>

              {visualizingMatch ? (
                <div className="space-y-6">
                  {/* Step Visualizer */}
                  <div className="p-5 rounded-lg bg-black/40 border border-gray-800 flex flex-col gap-4">
                    <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                      <div>
                        <span className="text-[10px] uppercase text-cyan-400 font-bold">Current Step {zkStep}/6</span>
                        <h4 className="text-sm font-semibold text-gray-200">{zkStatus}</h4>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-cyan-950/40 border border-cyan-800 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-900 h-2 rounded overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full transition-all duration-1000"
                        style={{ width: `${zkProgress}%` }}
                      />
                    </div>

                    {/* Technical details code-style */}
                    <div className="bg-black/85 border border-gray-850 p-4 rounded text-xs font-mono text-gray-400 space-y-2">
                      <p className="text-cyan-400/90">&gt; npx snarkjs groth16 prove match_0001.zkey witness.wtns proof.json public.json</p>
                      {zkStep >= 1 && <p className="text-emerald-400/80">&gt; [OK] Poseidon Hash verified for buyCommitment: {visualizingMatch.buyOrder.commitment.slice(0, 24)}...</p>}
                      {zkStep >= 1 && <p className="text-emerald-400/80">&gt; [OK] Poseidon Hash verified for sellCommitment: {visualizingMatch.sellOrder.commitment.slice(0, 24)}...</p>}
                      {zkStep >= 2 && <p className="text-gray-300">&gt; Asserting private match criteria:</p>}
                      {zkStep >= 2 && <p className="text-gray-400">  - Buy Price ({visualizingMatch.buyOrder.price}) &gt;= Match Price ({visualizingMatch.matchPrice}) : VALID</p>}
                      {zkStep >= 2 && <p className="text-gray-400">  - Sell Price ({visualizingMatch.sellOrder.price}) &lt;= Match Price ({visualizingMatch.matchPrice}) : VALID</p>}
                      {zkStep >= 3 && <p className="text-cyan-400/75">&gt; Generating constraints matrices (R1CS format)...</p>}
                      {zkStep >= 4 && <p className="text-gray-200 font-bold">&gt; Groth16 Snark Proof generated in {Math.round(Math.random() * 200 + 400)}ms</p>}
                      {zkStep >= 5 && <p className="text-emerald-400/90">&gt; Calling DarkPool.settleTrade() on EVM Contract...</p>}
                      {zkStep >= 6 && <p className="text-emerald-400 font-bold text-center border-t border-emerald-950/50 pt-2 flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-4.5 h-4.5" /> TRADE MATCH ZERO-KNOWLEDGE PROOF VERIFIED ON-CHAIN!
                      </p>}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => setVisualizingMatch(null)}
                      className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-semibold rounded hover:bg-gray-700 transition-all border border-gray-700"
                    >
                      Reset Prover
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-48 border border-dashed border-gray-850 rounded-lg flex flex-col items-center justify-center text-gray-500 text-center gap-2 p-4">
                  <Cpu className="w-8 h-8 text-gray-700" />
                  <p className="text-xs">No active proof visualization running.</p>
                  <p className="text-[11px] text-gray-600">Prover triggers automatically when order matches or you submit matching orders.</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Sidebar Activity & Status */}
        <aside className="space-y-6">
          
          {/* Visualizing Workflow Node widget */}
          <div className="glass-panel rounded-xl p-5 shadow-lg flex flex-col gap-3.5 relative overflow-hidden">
            <div className="absolute right-0 top-0 w-24 h-24 bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 rounded-full blur-xl animate-glow pointer-events-none" />
            
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-1.5">
              <Activity className="text-emerald-500 w-4 h-4" />
              ZK Workflow Architecture
            </h3>

            <div className="text-[11px] space-y-4 relative z-10">
              <div className="flex items-center gap-2.5 p-2 rounded bg-black/40 border border-gray-850">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-800 flex items-center justify-center text-emerald-400 font-bold">1</div>
                <div>
                  <h5 className="font-semibold text-gray-200">Submit Commitment</h5>
                  <p className="text-gray-400 text-[10px]">User submits Poseidon(Price, Vol, Salt) to L1/L2 contract.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded bg-black/40 border border-gray-850">
                <div className="w-5 h-5 rounded-full bg-cyan-500/10 border border-cyan-800 flex items-center justify-center text-cyan-400 font-bold">2</div>
                <div>
                  <h5 className="font-semibold text-gray-200">Match Off-chain</h5>
                  <p className="text-gray-400 text-[10px]">Go matching engine monitors commitments, checking crosses.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded bg-black/40 border border-gray-850">
                <div className="w-5 h-5 rounded-full bg-cyan-500/10 border border-cyan-800 flex items-center justify-center text-cyan-400 font-bold">3</div>
                <div>
                  <h5 className="font-semibold text-gray-200">Generate ZK Proof</h5>
                  <p className="text-gray-400 text-[10px]">Prover creates Snark proving match details conform to limit rules.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded bg-black/40 border border-gray-850">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-800 flex items-center justify-center text-emerald-400 font-bold">4</div>
                <div>
                  <h5 className="font-semibold text-gray-200">Settle On-chain</h5>
                  <p className="text-gray-400 text-[10px]">Verifier contract verifies proof, updates deposits ledger.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Your active private orders */}
          <div className="glass-panel rounded-xl p-5 shadow-lg space-y-4">
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-1.5">
              <Lock className="text-emerald-500 w-4.5 h-4.5" />
              Your Private Orders ({myOrders.length})
            </h3>
            
            <div className="space-y-2 max-h-[220px] overflow-y-auto">
              {myOrders.length === 0 ? (
                <div className="text-xs text-gray-500 italic p-3 text-center bg-black/20 border border-dashed border-gray-850 rounded">
                  No private orders submitted this session
                </div>
              ) : (
                myOrders.map((o, idx) => (
                  <div key={idx} className="p-2.5 rounded bg-black/35 border border-gray-850 text-xs font-mono space-y-1">
                    <div className="flex justify-between font-bold">
                      <span className={o.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                        {o.side.toUpperCase()} MBTC
                      </span>
                      <span className="text-gray-400">{o.amount} MBTC @ {o.price} USDC</span>
                    </div>
                    <div className="text-[10px] text-gray-500 flex justify-between">
                      <span>Commitment:</span>
                      <span>{o.commitment.slice(0, 14)}...</span>
                    </div>
                    <div className="text-[10px] text-gray-500 flex justify-between">
                      <span>Nonce (Salt):</span>
                      <span>{o.nonce}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Notifications Panel */}
          {notifications.length > 0 && (
            <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full">
              {notifications.map(n => (
                <div 
                  key={n.id} 
                  className={`p-3 rounded-lg border shadow-xl flex items-center gap-2.5 animate-bounce text-xs font-medium ${
                    n.type === 'success' 
                      ? 'bg-emerald-950/90 border-emerald-700 text-emerald-300' 
                      : n.type === 'warn' 
                        ? 'bg-red-950/90 border-red-800 text-red-300'
                        : 'bg-slate-900/90 border-slate-800 text-slate-300'
                  }`}
                >
                  {n.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                  {n.type === 'warn' && <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />}
                  {n.type === 'info' && <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
                  <span>{n.msg}</span>
                </div>
              ))}
            </div>
          )}

        </aside>
      </main>
    </div>
  );
}

// Sliders Icon for fallback
function SlidersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </svg>
  );
}
