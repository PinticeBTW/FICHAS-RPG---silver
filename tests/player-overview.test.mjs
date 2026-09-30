import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { metricPercentage, newerSnapshot } from '../src/lib/playerOverview.ts'

test('zero is a real resource value; unknown values never become zero', () => {
  assert.equal(metricPercentage('0', '48'), 0)
  for (const value of ['', ' ', '-', '?', '12 PV', 'NaN', 'Infinity']) {
    assert.equal(metricPercentage(value, '48'), null)
    assert.equal(metricPercentage('12', value), null)
  }
  assert.equal(metricPercentage('12', '0'), null)
  assert.equal(metricPercentage('12', '-1'), null)
})

test('resource bars allow bonus totals, negative resources and decimal notation safely', () => {
  assert.equal(metricPercentage('45', '48'), 93.75)
  assert.equal(metricPercentage('42', '34'), 100)
  assert.equal(metricPercentage('-3', '48'), 0)
  assert.equal(metricPercentage('2,5', '10'), 25)
  assert.equal(metricPercentage('+18', '36'), 50)
})

test('a late initial read or old event cannot roll back a newer sheet', () => {
  const first = { updatedAt: '2026-09-30T10:00:00.000Z', hp: '48' }
  const newer = { updatedAt: '2026-09-30T10:01:00.000Z', hp: '0' }
  assert.equal(newerSnapshot(first, newer), newer)
  assert.equal(newerSnapshot(newer, first), newer)
  assert.equal(newerSnapshot(newer, null), newer)
  assert.equal(newerSnapshot(undefined, first), first)
  assert.equal(newerSnapshot(undefined, null), null)
})
