// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Landing } from './components/Landing'

beforeEach(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia; localStorage.clear() })
afterEach(cleanup)

describe('landing page', () => {
  it('has one h1 and a heading for every section', () => {
    render(<Landing />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const name of [/Built to be believed/, /first error in minutes/, /Security and privacy/, /Simple monthly pricing/, /Questions/]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
  })
  it('sends every call to action to sign up or sign in', () => {
    render(<Landing />)
    for (const l of screen.getAllByRole('link', { name: /Create your account|Get started/ })) expect(l.getAttribute('href')).toBe('#/signup')
    for (const l of screen.getAllByRole('link', { name: 'Sign in' })) expect(l.getAttribute('href')).toBe('#/signin')
  })
  it('is honest: unbuilt features are marked Planned, and no fake customer proof appears', () => {
    const { container } = render(<Landing />)
    expect(screen.getAllByText('Available now')).toHaveLength(6)
    expect(screen.getAllByText('Planned')).toHaveLength(4)
    for (const name of ['Alerts', 'Payment visibility', 'Codex Mail']) {
      const card = screen.getByRole('heading', { name }).closest('.card') as HTMLElement
      expect(within(card).getByText('Planned')).toBeTruthy()
    }
    expect(screen.getAllByText(/sample data/i).length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/trusted by|testimonial|\d+,000\+ (developers|teams)|SOC ?2|ISO ?27001|99\.\d+%/i)
  })
  it('makes no price or billing promise it cannot keep', () => {
    const { container } = render(<Landing />)
    expect(container.textContent).not.toMatch(/[$₦€£]\s?\d/)
    expect(container.textContent).toMatch(/not turned on/)
  })
  it('has an accessible FAQ that opens and closes', async () => {
    const user = userEvent.setup()
    render(<Landing />)
    const q = screen.getByText('Which languages and frameworks work?')
    const details = q.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(q)
    expect(details.open).toBe(true)
  })
  it('section links keep the route on the landing page and the theme toggle works', async () => {
    const user = userEvent.setup()
    render(<Landing />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    for (const n of ['Features', 'How it works', 'Security', 'Pricing', 'FAQ']) expect(within(nav).getByRole('link', { name: n }).getAttribute('href')).toBe('#/')
    await user.click(within(nav).getByRole('link', { name: 'Security' }))
    expect(window.location.hash === '' || window.location.hash === '#/' || window.location.hash === '#').toBe(true)
    const btn = screen.getByRole('button', { name: /Theme/ })
    const before = document.documentElement.dataset.theme
    await user.click(btn)
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })
  it('has a skip link and labelled landmarks', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
  })
})
