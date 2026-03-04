import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  Cpu, 
  Layers, 
  ArrowRight, 
  Play, 
  RotateCcw, 
  CheckCircle2, 
  Zap,
  Send,
  User,
  Settings,
  ArrowDown
} from 'lucide-react';
import { 
  AnimationStep, 
  LogEntry, 
  ChunkItem, 
  Key 
} from './types';

const INITIAL_MYSQL_DATA: Record<Key, string> = {
  'k1': 'v1',
  'k2': 'v2',
  'k3': 'v3',
  'k4': 'v4',
  'k5': 'v5',
  'k6': 'v6',
};

export default function App() {
  const [step, setStep] = useState<AnimationStep>('IDLE');
  const [mysqlData, setMysqlData] = useState(INITIAL_MYSQL_DATA);
  const [binlogQueue, setBinlogQueue] = useState<LogEntry[]>([]);
  const [chunkMemory, setChunkMemory] = useState<ChunkItem[]>([]);
  const [outputBuffer, setOutputBuffer] = useState<LogEntry[]>([]);
  const [kafkaStream, setKafkaStream] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [windowActive, setWindowActive] = useState(false);
  const [explanation, setExplanation] = useState('Click Start to begin the DBLog Watermark Algorithm process.');
  const [autoProcess, setAutoProcess] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const reset = () => {
    setStep('IDLE');
    setMysqlData(INITIAL_MYSQL_DATA);
    setBinlogQueue([]);
    setChunkMemory([]);
    setOutputBuffer([]);
    setKafkaStream([]);
    setIsPaused(false);
    setWindowActive(false);
    setAutoProcess(false);
    setExplanation('Click Start to begin the DBLog Watermark Algorithm process.');
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  // Helper to add user logs periodically or on demand
  const addUserLog = (key: Key, value: string) => {
    const newLog: LogEntry = {
      id: `user-${Date.now()}-${Math.random()}`,
      key,
      type: 'UPDATE',
      value,
      source: 'USER'
    };
    setBinlogQueue(prev => [...prev, newLog]);
  };

  const nextStep = useCallback(() => {
    switch (step) {
      case 'IDLE':
        setStep('PAUSE');
        setIsPaused(true);
        setExplanation('Step 1: Full Capture Coordinator signals Log Stream Processor to PAUSE. Binlogs will now accumulate in the pipeline.');
        // Add some initial user logs to show accumulation
        addUserLog('k10', 'v10');
        break;
      case 'PAUSE':
        setStep('WRITE_L');
        const lLog: LogEntry = { id: 'wm-l', key: 'watermark', type: 'WATERMARK', watermarkType: 'L', source: 'DBLOG' };
        setBinlogQueue(prev => [...prev, lLog]);
        setExplanation('Step 2: Coordinator writes Low Watermark (L) to MySQL. It enters the pipeline.');
        break;
      case 'WRITE_L':
        setStep('SELECT_CHUNK');
        setExplanation('Step 3: Coordinator fetches a chunk of data (k1-k6) into Chunk Memory. Meanwhile, user updates continue to pile up.');
        setChunkMemory(Object.entries(mysqlData).map(([k, v]) => ({ key: k, value: v })));
        // Simulate user updates during selection
        addUserLog('k1', 'v1_new');
        addUserLog('k7', 'v7');
        break;
      case 'SELECT_CHUNK':
        setStep('WRITE_H');
        const hLog: LogEntry = { id: 'wm-h', key: 'watermark', type: 'WATERMARK', watermarkType: 'H', source: 'DBLOG' };
        setBinlogQueue(prev => [...prev, hLog]);
        setExplanation('Step 4: Coordinator writes High Watermark (H). The capture window is now fully defined in the pipeline.');
        addUserLog('k8', 'v8');
        break;
      case 'WRITE_H':
        setStep('RESUME');
        setIsPaused(false);
        setExplanation('Step 5: Coordinator signals RESUME. The Processor will now start consuming the backlog from the pipeline.');
        break;
      case 'RESUME':
        setStep('CONSUMING');
        break;
      case 'CONSUMING':
        if (binlogQueue.length > 0) {
          const currentLog = binlogQueue[0];
          setBinlogQueue(prev => prev.slice(1));

          if (currentLog.type === 'WATERMARK') {
            if (currentLog.watermarkType === 'L') {
              setWindowActive(true);
              setExplanation('Processor encountered L. Cleaning window is now ACTIVE. Any matching keys in Chunk will be removed.');
            } else {
              setWindowActive(false);
              setStep('FLUSH_CHUNK');
              setExplanation('Processor encountered H. Cleaning window CLOSED. Preparing to flush clean data.');
            }
          } else {
            // Normal log processing
            setOutputBuffer(prev => [...prev, currentLog]);
            
            // Cleaning logic
            if (windowActive) {
              const inChunk = chunkMemory.some(c => c.key === currentLog.key);
              if (inChunk) {
                setChunkMemory(prev => prev.filter(c => c.key !== currentLog.key));
                setExplanation(`CLEANING: Found ${currentLog.key} in window. Removing from Chunk Memory to prevent stale data.`);
              }
            }
          }
        } else {
          setStep('COMPLETE');
          setExplanation('All logs processed. Pipeline is empty.');
        }
        break;
      case 'FLUSH_CHUNK':
        const cleanLogs: LogEntry[] = chunkMemory.map(c => ({
          id: `chunk-${c.key}`,
          key: c.key,
          type: 'INSERT',
          value: c.value,
          source: 'DBLOG'
        }));
        setOutputBuffer(prev => [...prev, ...cleanLogs]);
        setChunkMemory([]);
        setStep('DISPATCH');
        setExplanation('Step 6: Surviving clean records from Chunk Memory are merged into the Output Buffer.');
        break;
      case 'DISPATCH':
        setKafkaStream(outputBuffer);
        setStep('COMPLETE');
        setExplanation('Final Step: Data dispatched to Kafka. The stream is now a perfect mix of history and real-time updates.');
        break;
      case 'COMPLETE':
        setExplanation('Process Complete. Click Reset to run again.');
        break;
    }
  }, [step, binlogQueue, chunkMemory, windowActive, mysqlData]);

  // Auto-process effect
  useEffect(() => {
    if (step === 'CONSUMING' && binlogQueue.length > 0) {
      const timer = setTimeout(() => {
        nextStep();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [step, binlogQueue, nextStep]);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans p-4 md:p-8 overflow-x-hidden">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 border-b border-[#141414] pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-serif italic tracking-tight">DBLog Pipeline</h1>
          <p className="text-xs font-mono uppercase opacity-50 mt-1">Flow & Accumulation Visualization</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors text-sm font-mono uppercase"
          >
            <RotateCcw size={16} /> Reset
          </button>
          <button 
            onClick={nextStep}
            disabled={step === 'CONSUMING'}
            className="flex items-center gap-2 px-6 py-2 bg-[#141414] text-[#E4E3E0] hover:opacity-90 disabled:opacity-30 transition-opacity text-sm font-mono uppercase"
          >
            {step === 'IDLE' ? <Play size={16} /> : <ArrowRight size={16} />}
            {step === 'IDLE' ? 'Start' : step === 'CONSUMING' ? 'Processing...' : 'Next Step'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-12">
        
        {/* Status Banner */}
        <div className="bg-white border border-[#141414] p-4 flex items-start gap-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="p-2 bg-[#141414] text-white rounded-full">
            <Zap size={20} />
          </div>
          <div>
            <h3 className="font-mono text-xs uppercase font-bold opacity-50">Current Phase: {step}</h3>
            <p className="text-lg font-medium">{explanation}</p>
          </div>
        </div>

        {/* Top Section: Sources */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* User Activity */}
          <div className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-4 border-b border-[#141414] pb-2">
              <User size={18} />
              <h2 className="font-serif italic text-xl">User Activity</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {['k1', 'k2', 'k7', 'k10'].map(k => (
                <button 
                  key={k}
                  onClick={() => addUserLog(k, `v${Math.floor(Math.random()*100)}`)}
                  className="px-3 py-1 border border-[#141414] text-[10px] font-mono uppercase hover:bg-[#141414] hover:text-white transition-colors"
                >
                  Update {k}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[10px] font-mono opacity-50 leading-tight">
              Click buttons to simulate real-time user updates entering the system.
            </p>
          </div>

          {/* Coordinator */}
          <div className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-4 border-b border-[#141414] pb-2">
              <Settings size={18} />
              <h2 className="font-serif italic text-xl">Full Capture Coordinator</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-2 border text-[10px] font-mono uppercase ${step === 'WRITE_L' || step === 'WRITE_H' ? 'bg-[#141414] text-white' : 'opacity-30'}`}>
                Write Watermark
              </div>
              <div className={`p-2 border text-[10px] font-mono uppercase ${step === 'SELECT_CHUNK' ? 'bg-[#141414] text-white' : 'opacity-30'}`}>
                SELECT Snapshot
              </div>
            </div>
          </div>
        </div>

        {/* Middle Section: The Pipeline */}
        <div className="relative py-12">
          <div className="flex items-center justify-between gap-4">
            {/* MySQL */}
            <div className="flex flex-col items-center gap-2 z-10">
              <div className="w-20 h-20 bg-white border-2 border-[#141414] rounded-full flex items-center justify-center shadow-lg">
                <Database size={32} />
              </div>
              <span className="font-mono text-[10px] uppercase font-bold">MySQL</span>
            </div>

            {/* The Pipe */}
            <div className="flex-1 h-24 bg-[#D1D1D1] border-y-4 border-[#141414] relative overflow-hidden flex items-center px-4">
              <div className="absolute inset-0 opacity-10 pointer-events-none" 
                   style={{backgroundImage: 'repeating-linear-gradient(45deg, #000, #000 10px, transparent 10px, transparent 20px)'}} />
              
              <div className="flex gap-4 w-full">
                <AnimatePresence mode="popLayout">
                  {binlogQueue.map((log, idx) => (
                    <motion.div
                      key={log.id}
                      layout
                      initial={{ x: -100, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: 200, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                      className={`min-w-[80px] h-12 border-2 border-[#141414] flex flex-col items-center justify-center text-[8px] font-mono uppercase shadow-md ${
                        log.type === 'WATERMARK' ? 'bg-yellow-400' : log.source === 'USER' ? 'bg-white' : 'bg-blue-200'
                      }`}
                    >
                      <span className="font-bold">{log.type === 'WATERMARK' ? `WM: ${log.watermarkType}` : log.key}</span>
                      <span className="opacity-50">{log.source}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {isPaused && binlogQueue.length > 5 && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-red-500 text-white px-2 py-1 text-[10px] font-mono animate-pulse border border-[#141414]">
                  BACKLOG PILED UP!
                </div>
              )}
            </div>

            {/* Processor */}
            <div className="flex flex-col items-center gap-2 z-10">
              <div className={`w-20 h-20 border-2 border-[#141414] rounded-lg flex items-center justify-center shadow-lg transition-colors ${isPaused ? 'bg-red-100' : 'bg-green-100'}`}>
                <Cpu size={32} className={isPaused ? '' : 'animate-spin-slow'} />
              </div>
              <span className="font-mono text-[10px] uppercase font-bold">Log Processor</span>
              <div className={`text-[8px] font-mono uppercase px-1 border ${isPaused ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                {isPaused ? 'Paused' : 'Active'}
              </div>
            </div>
          </div>
          
          {/* Flow Indicator */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 text-[10px] font-mono uppercase opacity-30 flex items-center gap-2">
            Binlog Stream Pipeline <ArrowRight size={12} />
          </div>
        </div>

        {/* Bottom Section: Internal State */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Chunk Memory */}
          <div className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-4 border-b border-[#141414] pb-2">
              <Layers size={18} />
              <h2 className="font-serif italic text-xl">Chunk Memory</h2>
              {windowActive && <div className="ml-auto text-[8px] bg-yellow-400 px-1 animate-pulse">CLEANING WINDOW</div>}
            </div>
            <div className="grid grid-cols-2 gap-2 min-h-[120px]">
              <AnimatePresence>
                {chunkMemory.map(item => (
                  <motion.div
                    key={item.key}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0, backgroundColor: '#ef4444' }}
                    className="p-2 border border-[#141414]/10 bg-[#F8F8F8] text-[10px] font-mono flex justify-between"
                  >
                    <span>{item.key}</span>
                    <span className="opacity-50">{item.value}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {chunkMemory.length === 0 && (
                <div className="col-span-2 flex items-center justify-center text-[10px] font-mono opacity-20 uppercase">
                  Empty
                </div>
              )}
            </div>
          </div>

          {/* Output Buffer */}
          <div className="bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-4 border-b border-[#141414] pb-2">
              <CheckCircle2 size={18} />
              <h2 className="font-serif italic text-xl">Output Buffer</h2>
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-2">
              {outputBuffer.map((log, idx) => (
                <div key={`${log.id}-${idx}`} className="p-1 border border-[#141414]/10 text-[9px] font-mono flex justify-between items-center">
                  <span className="opacity-30">#{idx+1}</span>
                  <span className="flex-1 px-2">{log.key}: {log.value}</span>
                  <span className={`text-[7px] px-1 ${log.source === 'USER' ? 'bg-gray-100' : 'bg-blue-100'}`}>{log.source}</span>
                </div>
              ))}
              {outputBuffer.length === 0 && (
                <div className="py-10 text-center text-[10px] font-mono opacity-20 uppercase">
                  Waiting...
                </div>
              )}
            </div>
          </div>

          {/* Kafka */}
          <div className="bg-[#141414] text-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="flex items-center gap-2 mb-4 border-b border-white/20 pb-2">
              <Send size={18} />
              <h2 className="font-serif italic text-xl">Kafka Stream</h2>
            </div>
            <div className="space-y-2">
              {kafkaStream.map((log, idx) => (
                <motion.div
                  key={`k-${log.id}-${idx}`}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-2 border border-white/10 text-[10px] font-mono flex justify-between"
                >
                  <span>{log.key}</span>
                  <span className="opacity-50">{log.value}</span>
                </motion.div>
              ))}
              {kafkaStream.length === 0 && (
                <div className="py-10 text-center text-[10px] font-mono opacity-20 uppercase">
                  Offline
                </div>
              )}
            </div>
          </div>
        </div>

      </main>

      <footer className="max-w-7xl mx-auto mt-12 pt-4 border-t border-[#141414] flex justify-between items-center opacity-50 text-[10px] font-mono uppercase">
        <span>DBLog Pipeline Visualization</span>
        <div className="flex gap-4">
          <div className="flex items-center gap-1"><div className="w-2 h-2 bg-white border border-black"></div> User Update</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 bg-yellow-400 border border-black"></div> Watermark</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-200 border border-black"></div> Snapshot</div>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
      `}} />
    </div>
  );
}
