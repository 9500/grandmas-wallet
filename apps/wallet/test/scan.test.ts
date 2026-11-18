import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { makeLink } from '@grandmas-wallet/app/links';
import { describe, expect, it } from 'vitest';

import { type CameraInfo, CONNECTION_ADDRESS, HANDOVER_LINK, RECOVERER_LINK, cameraRound, describeCamera, facingOf, lensOf, nextCamera, paymentAddress } from '../src/scan.js';

/** The QR code scanner's decisions that need no camera: which cameras it goes round, and which codes a field takes. */

const cameras = (...labels: string[]): CameraInfo[] => labels.map((label, index) => ({ id: `id-${index}`, label }));
const labels = (round: CameraInfo[]): string[] => round.map((camera) => camera.label);

describe('the cameras', () => {
  it('are told apart by the way they face, in the words phones use', () => {
    expect(['camera2 0, facing back', 'Back Camera', 'Back Ultra Wide Camera', 'Rückkamera', 'Caméra arrière', 'Cámara trasera'].map(facingOf)).toEqual(Array(6).fill('rear'));
    expect(['camera2 1, facing front', 'Front Camera', 'FaceTime HD Camera', 'Frontkamera', 'Caméra avant'].map(facingOf)).toEqual(Array(5).fill('front'));
    expect(['Integrated Webcam', 'USB Video Device', 'Default Camera', 'Camera 2'].map(facingOf)).toEqual(Array(4).fill('unknown'));
  });

  it('name their lens only where the label names one', () => {
    expect(lensOf('Back Ultra Wide Camera')).toBe('Ultra wide');
    expect(lensOf('Back Telephoto Camera')).toBe('Telephoto');
    expect(lensOf('Back Dual Wide Camera')).toBe('Dual wide');
    expect(lensOf('Back Triple Camera')).toBe('Triple');
    expect(lensOf('Back Camera')).toBeUndefined();
    expect(lensOf('camera2 2, facing back')).toBeUndefined();
    expect(lensOf('Intel RealSense')).toBeUndefined();
  });

  it('go round the rear ones only, the main lens first and a telephoto lens last', () => {
    const phone = cameras('Front Camera', 'Back Telephoto Camera', 'Back Ultra Wide Camera', 'Back Camera', 'Back Dual Wide Camera');
    expect(labels(cameraRound(phone))).toEqual(['Back Camera', 'Back Dual Wide Camera', 'Back Ultra Wide Camera', 'Back Telephoto Camera']);
    const android = cameras('camera2 1, facing front', 'camera2 0, facing back', 'camera2 2, facing back', 'camera2 3, facing front');
    expect(labels(cameraRound(android))).toEqual(['camera2 0, facing back', 'camera2 2, facing back']);
  });

  it('are all offered when none can be told to face the rear', () => {
    expect(labels(cameraRound(cameras('FaceTime HD Camera', 'USB Camera')))).toEqual(['FaceTime HD Camera', 'USB Camera']);
    expect(cameraRound([])).toEqual([]);
  });

  it('follow one another round, starting again after the last', () => {
    const round = cameraRound(cameras('Back Camera', 'Back Ultra Wide Camera', 'Back Telephoto Camera'));
    expect(nextCamera(round, 'id-0')?.id).toBe('id-1');
    expect(nextCamera(round, 'id-1')?.id).toBe('id-2');
    expect(nextCamera(round, 'id-2')?.id).toBe('id-0');
    // A camera the round does not hold, such as the browser's own first choice, is followed by the first.
    expect(nextCamera(round, 'elsewhere')?.id).toBe('id-0');
    expect(nextCamera([], 'id-0')).toBeUndefined();
  });

  it('are described by their place in the round and their lens', () => {
    const round = cameraRound(cameras('Front Camera', 'Back Camera', 'Back Ultra Wide Camera', 'Back Telephoto Camera'));
    expect(describeCamera(round, 'id-1')).toBe('Camera 1 of 3');
    expect(describeCamera(round, 'id-2')).toBe('Camera 2 of 3 · Ultra wide');
    expect(describeCamera(round, 'id-3')).toBe('Camera 3 of 3 · Telephoto');
    // One rear camera: nothing to go round, so no count.
    expect(describeCamera(cameraRound(cameras('Front Camera', 'Back Camera')), 'id-1')).toBeUndefined();
    expect(describeCamera(cameraRound(cameras('Back Ultra Wide Camera')), 'id-0')).toBe('Ultra wide');
  });
});

describe('what a field takes', () => {
  const addressOf = (prefix: 'bchtest' | 'bitcoincash'): string => {
    const made = lockingBytecodeToCashAddress({ bytecode: Uint8Array.from([0x76, 0xa9, 0x14, ...Array<number>(20).fill(7), 0x88, 0xac]), prefix });
    if (typeof made === 'string') throw new Error(made);
    return made.address;
  };
  const testAddress = addressOf('bchtest');
  const mainAddress = addressOf('bitcoincash');

  it('a recoverer\'s link, and nothing else, in the field for it', async () => {
    const link = await makeLink('https://wallet.example/', 'recoverer', { name: 'Anna', page: 'https://recoverer.example/', publicKey: 'ab'.repeat(32) });
    expect(RECOVERER_LINK.accept(`${link}\n`)).toBe(link);
    expect(RECOVERER_LINK.accept(await makeLink('https://wallet.example/', 'handover', { sealed: '00' }))).toBeUndefined();
    expect(RECOVERER_LINK.accept(testAddress)).toBeUndefined();
    expect(RECOVERER_LINK.wrong).toContain('not a recoverer\'s link');
    expect(HANDOVER_LINK.accept(link)).toBeUndefined();
  });

  it('an application\'s connection address, in either of its forms', () => {
    expect(CONNECTION_ADDRESS.accept('wiz://?p=abc&s=def')).toBe('wiz://?p=abc&s=def');
    expect(CONNECTION_ADDRESS.accept('WIZ://?P=ABC%3FS=DEF')).toBe('WIZ://?P=ABC%3FS=DEF');
    expect(CONNECTION_ADDRESS.accept(testAddress)).toBeUndefined();
  });

  it('an address of the page\'s network, with or without its prefix; a payment request gives its address', () => {
    const field = paymentAddress('testnet');
    expect(field.accept(testAddress)).toBe(testAddress);
    expect(field.accept(testAddress.replace('bchtest:', ''))).toBe(testAddress.replace('bchtest:', ''));
    expect(field.accept(`${testAddress}?amount=0.001`)).toBe(testAddress);
    expect(field.accept(mainAddress)).toBeUndefined();
    expect(field.accept('https://wallet.example/#recoverer=abc')).toBeUndefined();
    expect(paymentAddress('mainnet').accept(mainAddress)).toBe(mainAddress);
    expect(paymentAddress('mainnet').accept(testAddress)).toBeUndefined();
  });
});
