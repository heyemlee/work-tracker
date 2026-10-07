import { describe, expect, it } from 'vitest';
import { pickPlace } from './geo';

describe('pickPlace', () => {
  // Greenhouse's suggestions for "Santa Clara", in its order.
  const suggestions = [
    'Santa Clara, Villa Clara, Cuba',
    'Santa Clara, California, United States',
    'Santa Clara, Utah, United States',
    'Santa Clara del Mar, Buenos Aires, Argentina',
  ];

  it('tells a city from its namesakes by its state, under either name', () => {
    expect(pickPlace(suggestions, 'Santa Clara, CA')).toBe('Santa Clara, California, United States');
    expect(pickPlace(suggestions, 'Santa Clara, California')).toBe('Santa Clara, California, United States');
    expect(pickPlace(['San Jose, Costa Rica', 'San Jose, CA, USA'], 'San Jose, California')).toBe(
      'San Jose, CA, USA',
    );
  });

  it('picks none when the state isn’t among them, or isn’t known', () => {
    expect(pickPlace(suggestions, 'Santa Clara, TX')).toBeNull();
    expect(pickPlace(suggestions, 'Santa Clara')).toBeNull();
  });
});
