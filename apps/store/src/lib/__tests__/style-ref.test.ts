import { describe, expect, it } from 'vitest';
import { styleRef } from '../style-ref';

/** The tests run in node: a stand-in for the part of the CSSOM the helper touches. */
function fakeElement(): { element: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>();
  const element = {
    style: {
      setProperty: (name: string, value: string) => props.set(name, value),
      removeProperty: (name: string) => props.delete(name),
    },
  } as unknown as HTMLElement;
  return { element, props };
}

describe('styleRef', () => {
  it('writes each value with setProperty (CSS and custom properties)', () => {
    const { element, props } = fakeElement();
    styleRef({ width: '40%', '--a': '12deg' })(element);
    expect(props.get('width')).toBe('40%');
    expect(props.get('--a')).toBe('12deg');
  });

  it('removes a property whose value is null', () => {
    const { element, props } = fakeElement();
    props.set('background', 'red');
    styleRef({ background: null })(element);
    expect(props.has('background')).toBe(false);
  });

  it('ignores an unmounted element', () => {
    expect(() => styleRef({ width: '1px' })(null)).not.toThrow();
  });
});
