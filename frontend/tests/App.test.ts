import { describe, it, expect } from 'vitest';
import { mountWithPlugins } from './testUtils';
import App from '../src/App.vue';

describe('App', () => {
  it('mounts without throwing', () => {
    const wrapper = mountWithPlugins(App);
    expect(wrapper.exists()).toBe(true);
  });
});
