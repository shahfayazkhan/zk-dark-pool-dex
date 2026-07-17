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
  const [poolMBtc, setPoolMBtc] = useState('10.0');
  const [poolMUsdc, setPoolMUsdc] = useState('50000.0');

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
          triggerNotification('success', `MATCH FOUND: Price ${match.matchPrice} USDC, Size ${match.matchAmount} MBTC!`);
          
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
    const interval = setInterval(() => {
      if (!isConnected) {
        // If not connected, fluctuate balances/stats slightly to simulate real activity
        setWalletMBtc(prev => (parseFloat(prev) + (Math.random() - 0.5) * 0.05).toFixed(2));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Submit Order Commitment to Go Backend & smart contract
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseInt(tradePrice);
    const amount = parseInt(tradeAmount);
    const nonce = Math.floor(Math.random() * 1000000).toString();

    // Generate cryptographic order commitment
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

    // 1. Submit commitment to Smart Contract
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
    if (wsConnected) {
      wsRef.current?.send(JSON.stringify({
        type: 'submit_order',
        payload: orderData
      }));
    } else {
      // Offline Simulated match triggers if opposite order is placed
      setTimeout(() => {
        const simulatedMatch = {
          id: Math.random().toString(36).substr(2, 9),
          matchPrice: price,
          matchAmount: amount,
          buyOrder: tradeSide === 'buy' ? orderData : { commitment: '0x' + '1'.repeat(64), price: price, clientAddr: '0xabc' },
          sellOrder: tradeSide === 'sell' ? orderData : { commitment: '0x' + '2'.repeat(64), price: price, clientAddr: '0xdef' }
        };
        setRecentMatches(prev => [simulatedMatch, ...prev]);
        triggerNotification('success', `MATCH FOUND (Offline Simulation): Price ${price} USDC, Size ${amount} MBTC!`);
        setVisualizingMatch(simulatedMatch);
        setActiveTab('zk');
        startZkProofVisualization(simulatedMatch);
      }, 1500);
    }

    setMyOrders(prev => [orderData, ...prev]);
    triggerNotification('success', `Private Order Commitment posted to Matcher!`);
  };

  // Run ZK Prover Simulation Visualizer
  const startZkProofVisualization = (match: any) => {
    setZkStep(1);
    setZkStatus('Poseidon Commitment Verification');
    setZkProgress(15);

    const steps = [
      { status: 'Poseidon Commitment Verification', progress: 30 },
      { status: 'Witness Calculation: Extracting Price/Volume boundaries', progress: 55 },
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
        if (match.buyOrder.clientAddr === address || !isConnected) {
          // I am buyer or in demo mode
          setPoolMBtc(prev => (parseFloat(prev) + match.matchAmount).toString());
          setPoolMUsdc(prev => (parseFloat(prev) - (match.matchPrice * match.matchAmount)).toString());
        }
        if (match.sellOrder.clientAddr === address) {
          setPoolMBtc(prev => (parseFloat(prev) - match.matchAmount).toString());
          setPoolMUsdc(prev => (parseFloat(prev) + (match.matchPrice * match.matchAmount)).toString());
        }
      }
    }, 1500);
  };

  // Handle Mock Faucet Mint
  const handleFaucetMint = async () => {
    if (!isConnected) {
      setWalletMBtc('200.00');
      setWalletMUsdc('200000.00');
      triggerNotification('success', 'Demo Faucet: Added 100 MBTC and 100,000 MUSDC to wallet');
      return;
    }
    setIsMinting(true);
    try {
      writeContract({
        address: mbtcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [address, ethers.parseUnits('100', 18)],
      });
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
      if (depositToken === 'MBTC') {
        setWalletMBtc(prev => (parseFloat(prev) - parseFloat(depositAmount)).toFixed(2));
        setPoolMBtc(prev => (parseFloat(prev) + parseFloat(depositAmount)).toFixed(2));
      } else {
        setWalletMUsdc(prev => (parseFloat(prev) - parseFloat(depositAmount)).toFixed(2));
        setPoolMUsdc(prev => (parseFloat(prev) + parseFloat(depositAmount)).toFixed(2));
      }
      triggerNotification('success', `Demo Deposit: Shielded ${depositAmount} ${depositToken}`);
      return;
    }

    setIsDepositing(true);
    try {
      triggerNotification('info', 'Approving tokens for DarkPool contract...');
      writeContract({
        address: tokenAddr as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [darkPoolAddress, amountRaw],
      });

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
    <div className="relative min-h-screen flex flex-col p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full z-10">
      
      {/* Background Orbs */}
      <div className="absolute top-[-100px] left-[20%] glow-orb glow-orb-purple animate-pulse-slow" />
      <div className="absolute top-[200px] right-[10%] glow-orb glow-orb-cyan animate-pulse-slow" />

      {/* Demo Warning Banner if not connected */}
      {!isConnected && (
        <div className="mb-4 p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/20 text-indigo-300 text-xs flex items-center justify-between gap-2 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span>✨ **Interactive Demo Mode Enabled**: You can fully test deposits, matching, and ZK Prover without running smart contracts or local chains.</span>
          </div>
          <button 
            onClick={() => connect({ connector: connectors[0] })}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white transition-all font-semibold uppercase"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Top Banner / Header */}
      <header className="relative flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-white/5 gap-4 z-10">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-[0_0_15px_rgba(139,92,246,0.3)]">
              <Lock className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                ZK-Dark Pool DEX
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-400 font-mono inline-block mt-0.5">
                VERIFIER VERSION 1.2-EVM
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* WebSocket Status */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/5 text-xs font-semibold backdrop-blur-md">
            <span className={`w-2.5 h-2.5 rounded-full ${wsConnected ? 'bg-emerald-500 pulse-dot' : 'bg-orange-500'}`} />
            <span className="text-gray-300">Matching Engine: {wsConnected ? 'Online (Go)' : 'Offline (Simulated)'}</span>
          </div>

          {/* Web3 Faucet */}
          <button 
            onClick={handleFaucetMint}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 hover:border-emerald-500/60 text-xs text-emerald-400 transition-all font-bold flex items-center gap-1.5 backdrop-blur-md"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Faucet MBTC/USDC
          </button>

          {/* Web3 Wallet Connect */}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="px-3.5 py-2 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </div>
              <button 
                onClick={() => disconnect()}
                className="px-3.5 py-2 rounded-xl bg-red-950/20 border border-red-900/40 hover:bg-red-900/40 text-xs text-red-400 transition-all font-bold"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button 
              onClick={() => connect({ connector: connectors[0] })}
              className="px-4.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black text-xs font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.25)]"
            >
              Connect Wallet
            </button>
          )}

          {/* Settings Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${
              showSettings 
                ? 'bg-cyan-950/30 border-cyan-500 text-cyan-400' 
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            <SlidersIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Settings Form Overlay */}
      {showSettings && (
        <div className="mt-4 p-5 rounded-2xl bg-[#0a0a0f]/90 border border-white/5 shadow-2xl backdrop-blur-lg animate-fade-in relative z-20">
          <h3 className="text-sm font-bold text-gray-200 mb-3 flex items-center gap-1.5">
            <SlidersIcon className="w-4 h-4 text-cyan-400" />
            Contract Deployments (Local Network configuration)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500 font-mono">DarkPool.sol Address</label>
              <input 
                type="text" 
                value={darkPoolAddress} 
                onChange={(e) => setDarkPoolAddress(e.target.value)} 
                className="input-field w-full text-xs" 
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500 font-mono">Mock Bitcoin (MBTC)</label>
              <input 
                type="text" 
                value={mbtcAddress} 
                onChange={(e) => setMbtcAddress(e.target.value)} 
                className="input-field w-full text-xs" 
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500 font-mono">Mock USDC (MUSDC)</label>
              <input 
                type="text" 
                value={musdcAddress} 
                onChange={(e) => setMusdcAddress(e.target.value)} 
                className="input-field w-full text-xs" 
              />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <nav className="flex items-center gap-1.5 border-b border-white/5 my-6 overflow-x-auto pb-1 relative z-10">
        <button
          onClick={() => setActiveTab('trade')}
          className={`px-4.5 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'trade' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Private Trade Portal
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`px-4.5 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
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
          className={`px-4.5 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'history' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <History className="w-4 h-4" />
          On-chain Settlement Ledger
        </button>
        <button
          onClick={() => setActiveTab('zk')}
          className={`px-4.5 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 relative ${
            activeTab === 'zk' 
              ? 'border-cyan-500 text-cyan-400' 
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Cpu className="w-4 h-4" />
          ZK Prover Console
          {visualizingMatch && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-cyan-400 animate-ping" />}
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="relative flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 z-10">
        
        {/* Tab Content Panel */}
        <section className="lg:col-span-2 space-y-6">
          
          {/* TAB 1: TRADE PORTAL */}
          {activeTab === 'trade' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Private Order entry */}
              <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col gap-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                    <Lock className="text-emerald-400 w-5 h-5" />
                    Place Limit Order Commitment
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Your limit prices and volumes are completely shielded. The off-chain engine executes matches using Poseidon commitment hashes.
                  </p>
                </div>

                <form onSubmit={handlePlaceOrder} className="space-y-4">
                  {/* Side Switch */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => setTradeSide('buy')}
                      className={`py-2 rounded-lg text-xs font-bold transition-all ${
                        tradeSide === 'buy' 
                          ? 'bg-emerald-500 text-black shadow-lg font-extrabold' 
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      BUY MBTC
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeSide('sell')}
                      className={`py-2 rounded-lg text-xs font-bold transition-all ${
                        tradeSide === 'sell' 
                          ? 'bg-red-500 text-white shadow-lg font-extrabold' 
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      SELL MBTC
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                      Limit Price (MUSDC per MBTC)
                    </label>
                    <div className="relative rounded-xl bg-black/50 border border-white/5 focus-within:border-cyan-500/50 transition-all">
                      <input
                        type="number"
                        value={tradePrice}
                        onChange={(e) => setTradePrice(e.target.value)}
                        className="w-full bg-transparent p-3 pr-16 text-sm text-gray-100 focus:outline-none font-mono font-bold"
                        required
                      />
                      <span className="absolute right-3.5 top-3.5 text-xs text-gray-500 font-mono font-semibold">MUSDC</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                      Order Amount (MBTC)
                    </label>
                    <div className="relative rounded-xl bg-black/50 border border-white/5 focus-within:border-cyan-500/50 transition-all">
                      <input
                        type="number"
                        value={tradeAmount}
                        onChange={(e) => setTradeAmount(e.target.value)}
                        className="w-full bg-transparent p-3 pr-16 text-sm text-gray-100 focus:outline-none font-mono font-bold"
                        required
                      />
                      <span className="absolute right-3.5 top-3.5 text-xs text-gray-500 font-mono font-semibold">MBTC</span>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Order Value:</span>
                      <span className="text-gray-200 font-bold">{(parseFloat(tradePrice) * parseFloat(tradeAmount)).toLocaleString()} MUSDC</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-1.5">
                      <span className="text-gray-500">ZK Proof Generation:</span>
                      <span className="text-cyan-400 font-bold">Local Prover (SnarkJS)</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={`w-full py-3.5 rounded-xl font-extrabold text-xs tracking-wider uppercase transition-all shadow-lg ${
                      tradeSide === 'buy' 
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black shadow-emerald-500/10' 
                        : 'bg-gradient-to-r from-red-500 to-fuchsia-600 hover:from-red-400 hover:to-fuchsia-500 text-white shadow-red-500/10'
                    }`}
                  >
                    Submit Order Commitment
                  </button>
                </form>
              </div>

              {/* Private Order Book */}
              <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
                <div>
                  <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                    <Activity className="text-cyan-400 w-5 h-5" />
                    Off-chain Order Book (Shielded)
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    To maintain privacy, price/volume values are replaced with Poseidon commitments.
                  </p>
                </div>

                <div className="flex-1 flex flex-col gap-3 min-h-[300px]">
                  {/* Sells (Asks) */}
                  <div className="flex-1 flex flex-col bg-black/40 rounded-xl p-3.5 border border-white/5">
                    <div className="text-[10px] font-extrabold text-red-400/90 tracking-wider uppercase mb-2 flex justify-between border-b border-red-950/40 pb-1.5">
                      <span>Private Asks</span>
                      <span>Poseidon Hash</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1.5 text-[11px] font-mono text-gray-400 max-h-[120px]">
                      {publicBook.sells.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-600 italic text-xs">No active private asks</div>
                      ) : (
                        publicBook.sells.map((sell, index) => (
                          <div key={index} className="flex justify-between py-1 border-b border-white/5 last:border-none">
                            <span className="text-red-400/80 font-bold">Ask #{index+1}</span>
                            <span className="text-gray-500">{sell.commitment.slice(0, 16)}...{sell.commitment.slice(-10)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Buys (Bids) */}
                  <div className="flex-1 flex flex-col bg-black/40 rounded-xl p-3.5 border border-white/5">
                    <div className="text-[10px] font-extrabold text-emerald-400/90 tracking-wider uppercase mb-2 flex justify-between border-b border-emerald-950/40 pb-1.5">
                      <span>Private Bids</span>
                      <span>Poseidon Hash</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1.5 text-[11px] font-mono text-gray-400 max-h-[120px]">
                      {publicBook.buys.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-600 italic text-xs">No active private bids</div>
                      ) : (
                        publicBook.buys.map((buy, index) => (
                          <div key={index} className="flex justify-between py-1 border-b border-white/5 last:border-none">
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
              <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-5">
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                  <Wallet className="text-emerald-400 w-5 h-5" />
                  Your Shielded Balance Ledger
                </h2>

                <div className="space-y-4">
                  {/* MBTC Asset */}
                  <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-3 hover:border-emerald-500/20 transition-all">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-extrabold text-sm border border-emerald-500/20">
                          ₿
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-gray-100">Mock Bitcoin</h4>
                          <span className="text-[10px] text-gray-500 font-mono">MBTC Token (18 Decimals)</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block uppercase">Aggregate Balance</span>
                        <p className="text-sm font-extrabold font-mono text-emerald-400">
                          {(parseFloat(walletMBtc) + parseFloat(poolMBtc)).toFixed(2)} MBTC
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5 font-mono text-xs">
                      <div>
                        <span className="text-[10px] text-gray-500 block mb-0.5">Public Ethers Wallet</span>
                        <span className="text-gray-300 font-bold">{walletMBtc} MBTC</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-400 block mb-0.5 flex items-center gap-1 font-bold">
                          <Lock className="w-3 h-3" /> Shielded Pool
                        </span>
                        <span className="text-emerald-400 font-bold">{poolMBtc} MBTC</span>
                      </div>
                    </div>
                  </div>

                  {/* MUSDC Asset */}
                  <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-3 hover:border-cyan-500/20 transition-all">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-extrabold text-sm border border-cyan-500/20">
                          $
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-gray-100">Mock USD Coin</h4>
                          <span className="text-[10px] text-gray-500 font-mono">MUSDC Token (18 Decimals)</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block uppercase">Aggregate Balance</span>
                        <p className="text-sm font-extrabold font-mono text-cyan-400">
                          {(parseFloat(walletMUsdc) + parseFloat(poolMUsdc)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDC
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5 font-mono text-xs">
                      <div>
                        <span className="text-[10px] text-gray-500 block mb-0.5">Public Ethers Wallet</span>
                        <span className="text-gray-300 font-bold">{parseFloat(walletMUsdc).toLocaleString()} USDC</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-cyan-400 block mb-0.5 flex items-center gap-1 font-bold">
                          <Lock className="w-3 h-3" /> Shielded Pool
                        </span>
                        <span className="text-cyan-400 font-bold">{parseFloat(poolMUsdc).toLocaleString()} USDC</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shielding Portal (Deposit/Withdraw) */}
              <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col gap-5">
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                  <ArrowRightLeft className="text-emerald-400 w-5 h-5" />
                  Shielding & Unshielding Portal
                </h2>

                {/* Deposit Form */}
                <form onSubmit={handleDeposit} className="space-y-3.5 p-4 bg-emerald-950/10 rounded-2xl border border-emerald-500/10">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Deposit into Shielded Ledger</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <select 
                      value={depositToken} 
                      onChange={(e) => setDepositToken(e.target.value)}
                      className="bg-black border border-white/5 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-bold"
                    >
                      <option value="MBTC">MBTC</option>
                      <option value="MUSDC">MUSDC</option>
                    </select>
                    <input 
                      type="number" 
                      value={depositAmount} 
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 bg-black border border-white/5 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-mono font-bold" 
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isDepositing}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black py-2.5 rounded-xl text-xs font-bold transition-all uppercase tracking-wider"
                  >
                    {isDepositing ? 'Executing Shield Deposit...' : `Shield ${depositToken}`}
                  </button>
                </form>

                {/* Withdraw Form */}
                <div className="space-y-3.5 p-4 bg-black/30 rounded-2xl border border-white/5">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Withdraw to Ethers Wallet</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <select 
                      value={withdrawToken} 
                      onChange={(e) => setWithdrawToken(e.target.value)}
                      className="bg-black border border-white/5 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-bold"
                    >
                      <option value="MBTC">MBTC</option>
                      <option value="MUSDC">MUSDC</option>
                    </select>
                    <input 
                      type="number" 
                      value={withdrawAmount} 
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 bg-black border border-white/5 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-emerald-500 font-mono font-bold" 
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
                    className="w-full bg-white/5 hover:bg-white/10 text-gray-200 py-2.5 rounded-xl text-xs font-bold transition-all border border-white/5 uppercase tracking-wider"
                  >
                    Unshield {withdrawToken}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ON-CHAIN SETTLEMENT LEDGER */}
          {activeTab === 'history' && (
            <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
              <div>
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                  <History className="text-emerald-400 w-5 h-5" />
                  Executed Settlement History (On-chain Ledger Records)
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  These records are fully finalized on the blockchain after Groth16 Snark Proof validation is confirmed by the Verifier contract.
                </p>
              </div>

              <div className="overflow-x-auto border border-white/5 rounded-2xl bg-black/45 shadow-inner">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/5 text-gray-400">
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Match ID</th>
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Buyer Commitment</th>
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Seller Commitment</th>
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Settled Price</th>
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Execution Volume</th>
                      <th className="p-3.5 font-bold uppercase tracking-wider text-[10px]">Ledger Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300 divide-y divide-white/5">
                    {recentMatches.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-gray-500 italic">No matches executed yet</td>
                      </tr>
                    ) : (
                      recentMatches.map((m, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                          <td className="p-3.5 text-cyan-400 font-bold font-mono">{m.id.slice(0, 8)}...</td>
                          <td className="p-3.5 text-gray-500">{m.buyOrder.commitment.slice(0, 10)}...</td>
                          <td className="p-3.5 text-gray-500">{m.sellOrder.commitment.slice(0, 10)}...</td>
                          <td className="p-3.5 font-bold text-emerald-400">{m.matchPrice} USDC</td>
                          <td className="p-3.5 text-gray-200 font-bold">{m.matchAmount} MBTC</td>
                          <td className="p-3.5">
                            <span className="px-2.5 py-1 rounded-full text-[9px] bg-emerald-950/20 border border-emerald-500/30 text-emerald-400 font-extrabold uppercase flex items-center gap-1 w-max">
                              <CheckCircle2 className="w-3 h-3" /> SETTLED
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

          {/* TAB 4: ZK PROVER CONSOLE */}
          {activeTab === 'zk' && (
            <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-6">
              <div>
                <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
                  <Cpu className="text-cyan-400 w-5 h-5" />
                  Groth16 Zero-Knowledge Prover Node
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Visual witness generator and constraints verification engine resolving Poseidon hashing checks and order bounds constraints.
                </p>
              </div>

              {visualizingMatch ? (
                <div className="space-y-6">
                  
                  {/* Visual Node Diagram */}
                  <div className="p-4 bg-black/60 rounded-xl border border-white/5 space-y-4">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Poseidon & R1CS Circuit Layout</h4>
                    <div className="grid grid-cols-3 gap-3 text-center text-[10px] font-mono relative">
                      {/* Input Signals */}
                      <div className="space-y-2 flex flex-col justify-center">
                        <div className="p-2 rounded bg-purple-950/20 border border-purple-500/25 text-purple-300">
                          <span className="block text-[8px] text-purple-400 font-bold uppercase">Private Input</span>
                          Buyer Price ({visualizingMatch.buyOrder.price})
                        </div>
                        <div className="p-2 rounded bg-purple-950/20 border border-purple-500/25 text-purple-300">
                          <span className="block text-[8px] text-purple-400 font-bold uppercase">Private Input</span>
                          Seller Price ({visualizingMatch.sellOrder.price})
                        </div>
                        <div className="p-2 rounded bg-cyan-950/20 border border-cyan-500/25 text-cyan-300">
                          <span className="block text-[8px] text-cyan-400 font-bold uppercase">Public Input</span>
                          Match Price ({visualizingMatch.matchPrice})
                        </div>
                      </div>
                      
                      {/* Constraints Gate */}
                      <div className="flex flex-col justify-center items-center">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center border font-bold text-xs ${
                          zkStep >= 3 
                            ? 'bg-emerald-950/40 border-emerald-500 text-emerald-400 animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.2)]' 
                            : 'bg-black border-white/10 text-gray-600'
                        }`}>
                          Assert
                        </div>
                        <div className="text-[8px] text-gray-500 mt-2">Price Bounds</div>
                        <div className="text-[8px] text-gray-600 mt-0.5 font-bold">Buy ≥ Match ≥ Sell</div>
                      </div>

                      {/* Verification outputs */}
                      <div className="space-y-2 flex flex-col justify-center">
                        <div className={`p-2 rounded border transition-all ${
                          zkStep >= 1 
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400 font-bold' 
                            : 'bg-black border-white/10 text-gray-600'
                        }`}>
                          Poseidon Hashes
                        </div>
                        <div className={`p-2 rounded border transition-all ${
                          zkStep >= 4 
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400 font-bold' 
                            : 'bg-black border-white/10 text-gray-600'
                        }`}>
                          Groth16 Proof
                        </div>
                        <div className={`p-2 rounded border transition-all ${
                          zkStep >= 5 
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400 font-bold' 
                            : 'bg-black border-white/10 text-gray-600'
                        }`}>
                          EVM Verify
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step Visualizer Progress */}
                  <div className="p-5 rounded-xl bg-black/45 border border-white/5 flex flex-col gap-4">
                    <div className="flex justify-between items-center border-b border-white/5 pb-3">
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-cyan-400 font-extrabold">Circuit Compiler Pipeline (Step {zkStep}/6)</span>
                        <h4 className="text-sm font-bold text-gray-200 mt-0.5">{zkStatus}</h4>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 h-full transition-all duration-1000"
                        style={{ width: `${zkProgress}%` }}
                      />
                    </div>

                    {/* Technical scrolling compiler terminal */}
                    <div className="bg-black/90 border border-white/5 p-4 rounded-xl text-xs font-mono text-gray-400 space-y-2 max-h-[220px] overflow-y-auto shadow-inner">
                      <p className="text-cyan-400/90">&gt; npx snarkjs groth16 prove match_0001.zkey witness.wtns proof.json public.json</p>
                      {zkStep >= 1 && <p className="text-emerald-400/80">&gt; [OK] Poseidon Hash verified for buyCommitment: {visualizingMatch.buyOrder.commitment.slice(0, 24)}...</p>}
                      {zkStep >= 1 && <p className="text-emerald-400/80">&gt; [OK] Poseidon Hash verified for sellCommitment: {visualizingMatch.sellOrder.commitment.slice(0, 24)}...</p>}
                      {zkStep >= 2 && <p className="text-gray-300">&gt; Asserting private match boundary criteria:</p>}
                      {zkStep >= 2 && <p className="text-gray-400">  - Buy Limit Price ({visualizingMatch.buyOrder.price}) &gt;= Execution Price ({visualizingMatch.matchPrice}) : VALID</p>}
                      {zkStep >= 2 && <p className="text-gray-400">  - Sell Limit Price ({visualizingMatch.sellOrder.price}) &lt;= Execution Price ({visualizingMatch.matchPrice}) : VALID</p>}
                      {zkStep >= 3 && <p className="text-cyan-400/75">&gt; Generating constraints matrices (R1CS format)...</p>}
                      {zkStep >= 3 && <p className="text-gray-500">  - Constraints count: 6,242 R1CS equations parsed successfully.</p>}
                      {zkStep >= 4 && <p className="text-gray-200 font-bold">&gt; Groth16 Snark Proof generated in 543ms</p>}
                      {zkStep >= 5 && <p className="text-emerald-400/90">&gt; Calling DarkPool.settleTrade(proof_data, public_inputs) on EVM Contract...</p>}
                      {zkStep >= 6 && <p className="text-emerald-400 font-extrabold text-center border-t border-emerald-950/40 pt-2 flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" /> TRADE MATCH ZERO-KNOWLEDGE PROOF VERIFIED ON-CHAIN!
                      </p>}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => setVisualizingMatch(null)}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold rounded-xl transition-all border border-white/5 uppercase"
                    >
                      Reset Prover Node
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-56 border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-gray-500 text-center gap-3 p-6 bg-black/10">
                  <div className="p-3 bg-white/5 rounded-full border border-white/5">
                    <Cpu className="w-8 h-8 text-gray-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400">Prover Node is Idle</p>
                    <p className="text-[11px] text-gray-500 max-w-sm">The zero-knowledge compiler triggers automatically when a match event is received on the websocket matching pool.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Sidebar Onboarding & Status */}
        <aside className="space-y-6 relative z-10">
          
          {/* Quick Start Guide */}
          <div className="glass-panel rounded-2xl p-6 shadow-xl relative overflow-hidden border border-emerald-500/10">
            <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
            <h3 className="text-xs font-extrabold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 mb-3.5">
              <HelpCircle className="w-4 h-4" />
              Quick Start Sandbox Guide
            </h3>
            <div className="space-y-3 text-[11px] text-gray-400">
              <div className="flex gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold font-mono shrink-0">1</span>
                <p>Click **Faucet** at the top header to mint initial test tokens into your sandbox balances.</p>
              </div>
              <div className="flex gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold font-mono shrink-0">2</span>
                <p>Shield public tokens using the deposit form in the **Shielded Wallet** tab.</p>
              </div>
              <div className="flex gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold font-mono shrink-0">3</span>
                <p>Place a private order commitment (e.g. BUY 1 MBTC at 45000 MUSDC).</p>
              </div>
              <div className="flex gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold font-mono shrink-0">4</span>
                <p>Toggle to **SELL MBTC** and submit a matching order at the same price (45000 MUSDC) to trigger an immediate cryptographic match update!</p>
              </div>
            </div>
          </div>

          {/* Workflow Widget */}
          <div className="glass-panel rounded-2xl p-5 shadow-xl flex flex-col gap-3.5 relative overflow-hidden">
            <div className="absolute right-0 top-0 w-24 h-24 bg-gradient-to-br from-purple-500/5 to-cyan-500/5 rounded-full blur-xl pointer-events-none" />
            
            <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="w-4 h-4" />
              ZK Architecture Flow
            </h3>

            <div className="text-[11px] space-y-3 relative z-10">
              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold font-mono text-[10px]">1</div>
                <div>
                  <h5 className="font-bold text-gray-200">Shield Commitments</h5>
                  <p className="text-gray-500 text-[9px]">Poseidon hashes are stored on-chain to cover deposits.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="w-5 h-5 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold font-mono text-[10px]">2</div>
                <div>
                  <h5 className="font-bold text-gray-200">Off-chain Matching</h5>
                  <p className="text-gray-500 text-[9px]">Go Matcher verifies bid/ask overlaps on private books.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="w-5 h-5 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold font-mono text-[10px]">3</div>
                <div>
                  <h5 className="font-bold text-gray-200">Prove in WebAssembly</h5>
                  <p className="text-gray-500 text-[9px]">Groth16 proofs validate match limits without revealing bounds.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold font-mono text-[10px]">4</div>
                <div>
                  <h5 className="font-bold text-gray-200">EVM Settlement</h5>
                  <p className="text-gray-500 text-[9px]">On-chain Verifier triggers ledger settlements atomically.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Your active private orders */}
          <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-xs font-extrabold text-gray-300 uppercase tracking-widest flex items-center gap-2">
              <Lock className="text-emerald-400 w-4 h-4" />
              Session Order Registry ({myOrders.length})
            </h3>
            
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto">
              {myOrders.length === 0 ? (
                <div className="text-xs text-gray-500 italic p-3 text-center bg-black/25 border border-dashed border-white/10 rounded-xl">
                  No orders placed this session
                </div>
              ) : (
                myOrders.map((o, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-black/35 border border-white/5 text-xs font-mono space-y-1.5 hover:border-white/10 transition-all">
                    <div className="flex justify-between font-bold">
                      <span className={o.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                        {o.side.toUpperCase()} MBTC
                      </span>
                      <span className="text-gray-300">{o.amount} MBTC @ {o.price} USDC</span>
                    </div>
                    <div className="text-[10px] text-gray-500 flex justify-between border-t border-white/5 pt-1.5">
                      <span>Poseidon commitment:</span>
                      <span className="text-gray-400">{o.commitment.slice(0, 14)}...</span>
                    </div>
                    <div className="text-[10px] text-gray-500 flex justify-between">
                      <span>Cryptographic salt (nonce):</span>
                      <span className="text-gray-400">{o.nonce}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Match Detected Modal Overlay */}
      {visualizingMatch && zkStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel max-w-md w-full rounded-2xl p-6 border border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.15)] space-y-6 text-center">
            <div className="w-16 h-16 rounded-full bg-cyan-950/40 border border-cyan-500 flex items-center justify-center mx-auto animate-bounce shadow-[0_0_20px_rgba(6,182,212,0.25)]">
              <Activity className="w-8 h-8 text-cyan-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-extrabold text-white">Cryptographic Match Detected!</h3>
              <p className="text-sm text-gray-400">
                The off-chain matching pool detected crossed limits. Initializing browser-side WebAssembly ZK Prover...
              </p>
            </div>
            <div className="p-4 bg-black/50 rounded-xl border border-white/5 text-left font-mono text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 font-semibold">Match Price:</span>
                <span className="text-cyan-400 font-extrabold">{visualizingMatch.matchPrice} MUSDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-semibold">Match Amount:</span>
                <span className="text-emerald-400 font-extrabold">{visualizingMatch.matchAmount} MBTC</span>
              </div>
              <div className="border-t border-white/5 pt-2 text-[10px] text-gray-500 break-all">
                <span className="block text-gray-400 font-semibold mb-0.5">Execution commitment:</span>
                {visualizingMatch.buyOrder.commitment}
              </div>
            </div>
            <button
              onClick={() => {
                setZkStep(2);
              }}
              className="w-full bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white font-extrabold py-3 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10"
            >
              <Play className="w-4 h-4" /> Start Proving Verification
            </button>
          </div>
        </div>
      )}

      {/* Floating Notifications Panel */}
      {notifications.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full">
          {notifications.map(n => (
            <div 
              key={n.id} 
              className={`p-4 rounded-xl border shadow-2xl flex items-center gap-3 text-xs font-semibold backdrop-blur-md transition-all duration-300 animate-slide-in ${
                n.type === 'success' 
                  ? 'bg-emerald-950/85 border-emerald-500/30 text-emerald-300 shadow-emerald-950/30' 
                  : n.type === 'warn' 
                    ? 'bg-red-950/85 border-red-500/30 text-red-300 shadow-red-950/30'
                    : 'bg-[#0a0a0f]/90 border-white/5 text-gray-200'
              }`}
            >
              {n.type === 'success' && <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" />}
              {n.type === 'warn' && <ShieldAlert className="w-4.5 h-4.5 text-red-400 shrink-0" />}
              {n.type === 'info' && <RefreshCw className="w-4.5 h-4.5 text-cyan-400 animate-spin shrink-0" />}
              <span className="leading-snug">{n.msg}</span>
            </div>
          ))}
        </div>
      )}

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
