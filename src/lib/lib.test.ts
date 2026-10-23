import { describe, expect, it } from 'vitest'
import { isValidName, isValidSlug, slugify } from './slug'
import { assignableRoles, canChangeMember, canDeleteOrg, canManageStructure, canRemoveMember, canViewAudit } from './perms'
import { errorMessage } from './api'
import { pageCount, rangeText } from './format'

describe('slugs', () => {
  it('turns names into valid short names', () => {
    expect(slugify('Acme Inc.')).toBe('acme-inc')
    expect(slugify('  Crème brûlée!! ')).toBe('creme-brulee')
    expect(slugify('---x---')).toBe('x')
  })
  it('limits length and never ends with a dash', () => {
    const s = slugify('a'.repeat(39) + ' bbb')
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('-')).toBe(false)
  })
  it('matches the database rule', () => {
    for (const ok of ['ab', 'a-b', 'acme', 'a1', 'x'.repeat(40)]) expect(isValidSlug(ok)).toBe(true)
    for (const bad of ['a', '-ab', 'ab-', 'A-b', 'a_b', 'a b', 'x'.repeat(41), '']) expect(isValidSlug(bad)).toBe(false)
  })
  it('checks names', () => {
    expect(isValidName(' Acme ')).toBe(true)
    expect(isValidName('   ')).toBe(false)
    expect(isValidName('x'.repeat(81))).toBe(false)
  })
})

describe('permissions mirror the database rules', () => {
  it('structure, audit and org deletion', () => {
    expect(canManageStructure('owner') && canManageStructure('admin')).toBe(true)
    expect(canManageStructure('developer') || canManageStructure('viewer')).toBe(false)
    expect(canViewAudit('admin')).toBe(true)
    expect(canViewAudit('viewer')).toBe(false)
    expect(canDeleteOrg('owner')).toBe(true)
    expect(canDeleteOrg('admin')).toBe(false)
  })
  it('only owners can hand out the owner role', () => {
    expect(assignableRoles('owner')).toContain('owner')
    expect(assignableRoles('admin')).not.toContain('owner')
    expect(assignableRoles('developer')).toEqual([])
  })
  it('admins cannot touch owners, nobody changes their own role', () => {
    expect(canChangeMember('admin', 'owner', false)).toBe(false)
    expect(canChangeMember('owner', 'owner', false)).toBe(true)
    expect(canChangeMember('owner', 'viewer', true)).toBe(false)
    expect(canChangeMember('viewer', 'viewer', false)).toBe(false)
  })
  it('any member may leave, but only managers remove others', () => {
    expect(canRemoveMember('viewer', 'viewer', true)).toBe(true)
    expect(canRemoveMember('viewer', 'viewer', false)).toBe(false)
    expect(canRemoveMember('admin', 'owner', false)).toBe(false)
    expect(canRemoveMember('owner', 'owner', false)).toBe(true)
  })
})

describe('error messages', () => {
  it('maps database codes to friendly text', () => {
    expect(errorMessage({ message: 'slug_taken' })).toMatch(/already taken/)
    expect(errorMessage({ message: 'last_owner' })).toMatch(/at least one owner/)
    expect(errorMessage({ message: 'forbidden' })).toMatch(/permission/)
  })
  it('never leaks raw errors', () => {
    expect(errorMessage({ message: 'relation "core.x" does not exist' })).toBe('Something went wrong. Please try again.')
    expect(errorMessage(null)).toBe('Something went wrong. Please try again.')
  })
})

describe('format', () => {
  it('pages and ranges', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(51, 25)).toBe(3)
    expect(rangeText(0, 1, 25)).toBe('No results')
    expect(rangeText(30, 2, 25)).toBe('Showing 26 to 30 of 30')
  })
})

import { barHeights, maskedKey, usagePercent } from './status'
describe('status helpers', () => {
  it('bar heights are relative and never zero', () => {
    expect(barHeights([0, 5, 10])).toEqual([3, 50, 100])
    expect(barHeights([])).toEqual([])
    expect(barHeights([0, 0])).toEqual([3, 3])
  })
  it('usage percent is capped and safe', () => {
    expect(usagePercent(62410, 100000)).toBe(62)
    expect(usagePercent(250000, 100000)).toBe(100)
    expect(usagePercent(5, 0)).toBe(0)
  })
  it('keys are masked', () => { expect(maskedKey('cdx_a1b2c3d4')).toBe('cdx_a1b2c3d4••••••••') })
})
