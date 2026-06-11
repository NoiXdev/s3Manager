import { describe, it, expect } from 'vitest';
import { transform } from './licenses-transform.mjs';

describe('transform', () => {
  it('maps verbose checker output to a compact sorted array', () => {
    const raw = {
      'react@19.2.0': { licenses: 'MIT', repository: 'https://github.com/facebook/react' },
      '@aws-sdk/client-s3@3.500.0': { licenses: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
    };
    expect(transform(raw)).toEqual([
      { name: '@aws-sdk/client-s3', version: '3.500.0', license: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
      { name: 'react', version: '19.2.0', license: 'MIT', repository: 'https://github.com/facebook/react' },
    ]);
  });

  it('joins array licenses and defaults missing fields', () => {
    const raw = {
      'dual@1.0.0': { licenses: ['MIT', 'ISC'] },
      'bare@2.0.0': {},
    };
    expect(transform(raw)).toEqual([
      { name: 'bare', version: '2.0.0', license: 'UNKNOWN', repository: null },
      { name: 'dual', version: '1.0.0', license: 'MIT OR ISC', repository: null },
    ]);
  });

  it('splits scoped names on the last @', () => {
    const raw = { '@scope/pkg@1.2.3': { licenses: 'MIT' } };
    expect(transform(raw)[0]).toEqual({ name: '@scope/pkg', version: '1.2.3', license: 'MIT', repository: null });
  });
});
