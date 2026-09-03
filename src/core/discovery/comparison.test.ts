import { describe, expect, it } from 'vitest';
import { splitComparison } from './comparison.js';

describe('splitComparison', () => {
  it('splits the common comparison forms', () => {
    expect(splitComparison('react vs vue')).toEqual({ a: 'react', b: 'vue' });
    expect(splitComparison('postgres versus mysql')).toEqual({ a: 'postgres', b: 'mysql' });
    expect(splitComparison('difference between TCP and UDP')).toEqual({ a: 'TCP', b: 'UDP' });
    expect(splitComparison('rust vs go which is better')).toEqual({ a: 'rust', b: 'go' });
    expect(splitComparison('compare kubernetes and docker swarm')).toMatchObject({ a: 'kubernetes' });
  });

  it('ignores non-comparison queries', () => {
    expect(splitComparison('how to install docker')).toBeNull();
    expect(splitComparison('coffee or tea')).toBeNull(); // "or" alone is not a comparison
    expect(splitComparison('vsphere setup guide')).toBeNull();
  });
});
