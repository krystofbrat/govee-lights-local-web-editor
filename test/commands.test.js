import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDo, valueAction, isValueWord } from '../lib/commands.js';

const act = (text) => parseDo(text)?.action;

test('on, off and toggle', () => {
  assert.deepEqual(parseDo('off'), { action: { power: false }, label: 'off' });
  assert.deepEqual(act('ON'), { power: true });
  assert.deepEqual(act(' toggle '), { power: 'toggle' });
});

test('brightness, whites and colors, alone or together', () => {
  assert.deepEqual(parseDo('40'), { action: { brightness: 40 }, label: '40%' });
  assert.deepEqual(act('40%'), { brightness: 40 });
  assert.deepEqual(act('0'), { power: false });
  assert.deepEqual(act('warm'), { kelvin: 2700 });
  assert.deepEqual(act('2700k'), { kelvin: 2700 });
  assert.deepEqual(act('red'), { color: '#ff0000' });
  assert.deepEqual(act('#f80'), { color: '#ff8800' });
  assert.deepEqual(parseDo('warm 40'), { action: { kelvin: 2700, brightness: 40 }, label: 'warm white 2700K, 40%' });
  assert.deepEqual(act('on blue 10'), { power: true, color: '#0022ff', brightness: 10 });
});

test('scenes, favorites, music and spelled-out commands', () => {
  assert.deepEqual(parseDo('scene Aurora'), { action: { scene: 'Aurora' }, label: 'scene Aurora' });
  assert.deepEqual(act('fav cozy evening'), { favorite: 'cozy evening' });
  assert.deepEqual(act('favorite cozy'), { favorite: 'cozy' });
  assert.deepEqual(act('music'), { music: '' });
  assert.deepEqual(act('music energic'), { music: 'energic' });
  assert.deepEqual(act('bright 30'), { brightness: 30 });
  assert.deepEqual(act('color blue'), { color: '#0022ff' });
  assert.deepEqual(act('temp cool'), { kelvin: 6500 });
});

test('anything else is a favorite or scene by name', () => {
  assert.deepEqual(parseDo('Movie'), { action: { preset: 'Movie' }, label: 'Movie' });
  assert.deepEqual(act('night light'), { preset: 'night light' });
  assert.deepEqual(act('scene'), { preset: 'scene' });
  assert.equal(parseDo(''), null);
  assert.equal(parseDo(undefined), null);
});

test('value words are the same ones the lights command takes', () => {
  assert.ok(isValueWord('40%') && isValueWord('warm') && isValueWord('#ff8800') && isValueWord('Red'));
  assert.ok(!isValueWord('movie'));
  assert.equal(valueAction('movie'), null);
  assert.deepEqual(valueAction('150'), [{ brightness: 100 }, '100%']);
});
