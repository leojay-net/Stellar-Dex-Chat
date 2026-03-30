import { rpc, scValToNative } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';

// Minimal interfaces to avoid import issues in script context
interface ContractEvent {
  id: string;
  type: 'deposit' | 'withdraw';
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  actor: string;
  amount: string;
  token?: string;
  version: number;
}

interface IndexerState {
  lastPagingToken: string;
  lastLedger: number;
  updatedAt: string;
}

// Config from env or defaults
const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT || 'CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR';
const server = new rpc.Server(RPC_URL);

const DATA_DIR = path.join(process.cwd(), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'contract-events.json');
const STATE_FILE = path.join(DATA_DIR, 'indexer-state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function getLatestLedger() {
  const latestLedgerResp = await server.getLatestLedger();
  return latestLedgerResp.sequence;
}

async function indexEvents() {
  console.log('Starting event indexing for contract:', CONTRACT_ID);

  let state: IndexerState = {
    lastPagingToken: '0',
    lastLedger: 0,
    updatedAt: new Date().toISOString()
  };

  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }

  const latestLedger = await getLatestLedger();
  const startLedger = state.lastLedger || (latestLedger - 10000); // Index last 10k ledgers if fresh start

  console.log(`Polling events from ledger ${startLedger} to ${latestLedger}`);

  try {
    const response = await server.getEvents({
      startLedger: startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
        },
      ],
      limit: 100,
    });

    const newEvents: ContractEvent[] = response.events.map((event) => {
      // Soroban events have topics and value
      // Topic 0: Version (u32)
      // Topic 1: Symbol (deposit/withdraw)
      // Topic 2: Address (actor)
      // Value: i128 (amount)
      
      const topics = event.topic.map(t => scValToNative(t));
      const value = scValToNative(event.value);
      
      const typeStr = topics[1] as string;
      const actor = topics[2] as string;
      const eventType: 'deposit' | 'withdraw' = typeStr === 'withdraw' ? 'withdraw' : 'deposit';
      const contractId = typeof event.contractId === 'string' ? event.contractId : (event.contractId as any)?.id || CONTRACT_ID;
      
      return {
        id: event.id,
        type: eventType,
        contractId: String(contractId),
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        txHash: event.txHash,
        actor: actor,
        amount: String(value),
        version: Number(topics[0]) || 1
      };
    }).filter(e => e.type === 'deposit' || e.type === 'withdraw');

    if (newEvents.length > 0) {
      console.log(`Found ${newEvents.length} new events.`);
      
      let existingEvents: ContractEvent[] = [];
      if (fs.existsSync(EVENTS_FILE)) {
        existingEvents = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
      }

      // Merge and deduplicate by ID
      const eventMap = new Map();
      existingEvents.forEach(e => eventMap.set(e.id, e));
      newEvents.forEach(e => eventMap.set(e.id, e));
      
      const mergedEvents = Array.from(eventMap.values())
        .sort((a, b) => b.ledger - a.ledger); // Newest first

      fs.writeFileSync(EVENTS_FILE, JSON.stringify(mergedEvents, null, 2));
    }

    // Update state
    state.lastLedger = latestLedger;
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    console.log('Indexing complete.');
  } catch (error) {
    console.error('Error indexing events:', error);
  }
}

// Run indexing
indexEvents().catch(console.error);
