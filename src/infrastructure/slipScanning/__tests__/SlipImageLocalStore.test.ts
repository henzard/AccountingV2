import { SlipImageLocalStore } from '../SlipImageLocalStore';
import type { FSAdapter } from '../SlipImageLocalStore';

function makeFSMock(): FSAdapter {
  return {
    documentDirectory: '/docs/',
    deleteAsync: jest.fn().mockResolvedValue(undefined),
    makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    EncodingType: { Base64: 'base64' },
  };
}

describe('SlipImageLocalStore', () => {
  it('deletes a slip directory', async () => {
    const fs = makeFSMock();
    const store = new SlipImageLocalStore(fs);
    await store.delete('s1');
    expect(fs.deleteAsync).toHaveBeenCalledWith('/docs/slips/s1', { idempotent: true });
  });

  it('saves a frame', async () => {
    const fs = makeFSMock();
    const store = new SlipImageLocalStore(fs);
    const uri = await store.save('s1', 0, 'dGVzdA==');
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
      '/docs/slips/s1/0.jpg',
      'dGVzdA==',
      expect.objectContaining({ encoding: 'base64' }),
    );
    expect(uri).toBe('/docs/slips/s1/0.jpg');
  });
});
