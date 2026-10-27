import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, migrateScene, serializeScene } from '../serialization/schema';
import { SCENE_VERSION } from '../engine/types';
import { PRESETS } from '../presets';
import { FlowGrid } from '../engine/fields';

describe('scene schema', () => {
  it('round-trips every preset through JSON', () => {
    for (const p of PRESETS) {
      const s = p.build();
      const back = migrateScene(JSON.parse(serializeScene(s)));
      expect(back).toEqual(s);
    }
  });

  it('migrates a v1 file (boolean trails, single colour)', () => {
    const v1 = {
      version: 1,
      name: 'Legacy',
      render: { trails: true },
      emitters: [{ id: 'x', name: 'Old', color: '#ff0000', shape: { type: 'circle' } }],
      forces: [],
    };
    const s = migrateScene(v1);
    expect(s.version).toBe(SCENE_VERSION);
    expect(s.render.trails).toBeCloseTo(0.85);
    expect(s.emitters[0].gradient[0].color).toBe('#ff0000');
    expect(s.emitters[0].shape.radius).toBeGreaterThan(0); // defaults filled in
    expect(s.prewarm).toBe(0);
  });

  it('rejects files from a newer version', () => {
    expect(() => migrateScene({ version: SCENE_VERSION + 1 })).toThrow();
  });

  it('encodes and decodes compressed share links', async () => {
    const s = PRESETS[3].build();
    const code = await encodeShare(s);
    expect(code).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(JSON.stringify(s).length);
    expect(await decodeShare(code)).toEqual(s);
  });

  it('serialises painted flow fields losslessly enough', () => {
    const g = new FlowGrid(16, 9);
    g.paint(8, 4, 1, 0, 3);
    const back = FlowGrid.fromData(g.toData());
    for (let i = 0; i < g.data.length; i++) expect(back.data[i]).toBeCloseTo(g.data[i], 1);
  });
});
