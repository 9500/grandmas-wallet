// Experiment 9: what is special about the header where verification stops?
import { ElectrumClient } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { hexToBin } from '@bitauth/libauth';
const client = new ElectrumClient('spike', '1.4.1', new ElectrumWebSocket('chipnet.9500.cash', { port: 443, encrypted: true }));
await client.connect();
const read = async (height) => {
  const header = hexToBin(await client.request('blockchain.block.header', height));
  const view = new DataView(header.buffer);
  return { height, time: view.getUint32(68, true), bits: view.getUint32(72, true).toString(16) };
};
let previous = await read(332440);
for (let height = 332441; height <= 332456; height++) {
  const header = await read(height);
  console.log(height, new Date(header.time * 1000).toISOString(), `gap ${String(header.time - previous.time).padStart(5)} s`, `bits ${header.bits}`);
  previous = header;
}
await client.disconnect(true);
process.exit(0);
