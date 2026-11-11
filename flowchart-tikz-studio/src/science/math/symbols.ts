/**
 * Symbol libraries. Data only: rendering and insertion live in the components.
 * Every entry is compiled by pdfLaTeX and typeset by MathJax in the test suite,
 * so nothing here can be a dead button.
 */

export interface SymbolDef {
  /** TeX inserted into the formula. */
  tex: string;
  /** What the button shows. */
  glyph: string;
  name: string;
  keywords?: string;
}

export interface SymbolCategory {
  id: string;
  label: string;
  symbols: SymbolDef[];
}

const s = (tex: string, glyph: string, name: string, keywords = ''): SymbolDef => ({ tex, glyph, name, keywords });

const greek = (rows: [string, string][]) => rows.map(([name, g]) => s(`\\${name}`, g, name, 'greek letter'));

export const MATH_CATEGORIES: SymbolCategory[] = [
  {
    id: 'arithmetic', label: 'Arithmetic',
    symbols: [
      s('+', '+', 'plus', 'add'), s('-', '−', 'minus', 'subtract'), s('\\times', '×', 'times', 'multiply cross'),
      s('\\div', '÷', 'divide'), s('=', '=', 'equals'), s('\\neq', '≠', 'not equal'), s('\\pm', '±', 'plus or minus'),
      s('\\mp', '∓', 'minus or plus'), s('\\cdot', '⋅', 'dot product', 'centre dot multiply'), s('\\ast', '∗', 'asterisk'),
      s('\\circ', '∘', 'compose', 'ring'), s('\\%', '%', 'percent'), s('!', '!', 'factorial'), s('\\infty', '∞', 'infinity'),
    ],
  },
  {
    id: 'greek-lower', label: 'Greek (lower)',
    symbols: greek([
      ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['varepsilon', 'ε'], ['zeta', 'ζ'],
      ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'],
      ['xi', 'ξ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'], ['varphi', 'φ'],
      ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
    ]),
  },
  {
    id: 'greek-upper', label: 'Greek (upper)',
    symbols: greek([
      ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'],
      ['Upsilon', 'Υ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
    ]),
  },
  {
    id: 'calculus', label: 'Calculus',
    symbols: [
      s('\\int', '∫', 'integral'), s('\\iint', '∬', 'double integral'), s('\\iiint', '∭', 'triple integral'), s('\\oint', '∮', 'contour integral'),
      s('\\partial', '∂', 'partial'), s('\\nabla', '∇', 'nabla', 'del gradient'), s('\\sum', '∑', 'sum', 'summation sigma'), s('\\prod', '∏', 'product'),
      s('\\coprod', '∐', 'coproduct'), s('\\lim', 'lim', 'limit'), s('\\to', '→', 'tends to', 'arrow'), s('\\mathrm{d}', 'd', 'differential'),
      s('\\sin', 'sin', 'sine', 'trig'), s('\\cos', 'cos', 'cosine', 'trig'), s('\\tan', 'tan', 'tangent', 'trig'), s('\\ln', 'ln', 'natural log'),
      s('\\log', 'log', 'logarithm'), s('\\exp', 'exp', 'exponential'), s('\\max', 'max', 'maximum'), s('\\min', 'min', 'minimum'), s('\\det', 'det', 'determinant'),
    ],
  },
  {
    id: 'sets', label: 'Sets',
    symbols: [
      s('\\in', '∈', 'element of'), s('\\notin', '∉', 'not element of'), s('\\ni', '∋', 'contains'), s('\\subset', '⊂', 'subset'), s('\\subseteq', '⊆', 'subset or equal'),
      s('\\supset', '⊃', 'superset'), s('\\supseteq', '⊇', 'superset or equal'), s('\\cup', '∪', 'union'), s('\\cap', '∩', 'intersection'), s('\\setminus', '∖', 'set minus', 'difference'),
      s('\\emptyset', '∅', 'empty set'), s('\\varnothing', '⌀', 'empty set (alt)'), s('\\mathbb{N}', 'ℕ', 'naturals'), s('\\mathbb{Z}', 'ℤ', 'integers'), s('\\mathbb{Q}', 'ℚ', 'rationals'),
      s('\\mathbb{R}', 'ℝ', 'reals'), s('\\mathbb{C}', 'ℂ', 'complex numbers'), s('\\aleph', 'ℵ', 'aleph', 'cardinal'),
    ],
  },
  {
    id: 'logic', label: 'Logic',
    symbols: [
      s('\\forall', '∀', 'for all'), s('\\exists', '∃', 'exists'), s('\\nexists', '∄', 'does not exist'), s('\\land', '∧', 'and'), s('\\lor', '∨', 'or'), s('\\neg', '¬', 'not'),
      s('\\Rightarrow', '⇒', 'implies'), s('\\Leftrightarrow', '⇔', 'if and only if'), s('\\Leftarrow', '⇐', 'implied by'), s('\\implies', '⟹', 'implies (long)'), s('\\iff', '⟺', 'iff (long)'),
      s('\\therefore', '∴', 'therefore'), s('\\because', '∵', 'because'), s('\\top', '⊤', 'true', 'tautology'), s('\\bot', '⊥', 'false', 'contradiction'),
    ],
  },
  {
    id: 'relations', label: 'Comparison',
    symbols: [
      s('<', '<', 'less than'), s('>', '>', 'greater than'), s('\\leq', '≤', 'less or equal'), s('\\geq', '≥', 'greater or equal'), s('\\ll', '≪', 'much less'), s('\\gg', '≫', 'much greater'),
      s('\\approx', '≈', 'approximately'), s('\\equiv', '≡', 'equivalent', 'identical'), s('\\propto', '∝', 'proportional'), s('\\sim', '∼', 'similar', 'tilde'), s('\\simeq', '≃', 'asymptotically equal'), s('\\cong', '≅', 'congruent'),
    ],
  },
  {
    id: 'geometry', label: 'Geometry',
    symbols: [
      s('\\angle', '∠', 'angle'), s('\\measuredangle', '∡', 'measured angle'), s('\\perp', '⊥', 'perpendicular'), s('\\parallel', '∥', 'parallel'), s('^\\circ', '°', 'degree'), s('\\triangle', '△', 'triangle'),
      s('\\square', '□', 'square'), s('\\Diamond', '◇', 'diamond'), s('\\cong', '≅', 'congruent'), s('\\sim', '∼', 'similar'),
    ],
  },
  {
    id: 'arrows', label: 'Arrows & misc',
    symbols: [
      s('\\rightarrow', '→', 'right arrow'), s('\\leftarrow', '←', 'left arrow'), s('\\leftrightarrow', '↔', 'both ways'), s('\\uparrow', '↑', 'up arrow'), s('\\downarrow', '↓', 'down arrow'), s('\\mapsto', '↦', 'maps to'),
      s('\\ldots', '…', 'low dots'), s('\\cdots', '⋯', 'centre dots'), s('\\vdots', '⋮', 'vertical dots'), s('\\ddots', '⋱', 'diagonal dots'), s('\\oplus', '⊕', 'direct sum', 'xor'), s('\\otimes', '⊗', 'tensor'),
      s('\\dagger', '†', 'dagger'), s('\\langle', '⟨', 'left angle bracket'), s('\\rangle', '⟩', 'right angle bracket'), s('\\quad', '␣␣', 'wide space'), s('\\,', '␣', 'thin space'),
    ],
  },
];

export const PHYSICS_CATEGORIES: SymbolCategory[] = [
  {
    id: 'mechanics', label: 'Mechanics',
    symbols: [
      s('\\vec{F}', 'F⃗', 'force', 'newton vector'), s('m', 'm', 'mass', 'kilogram'), s('\\vec{a}', 'a⃗', 'acceleration'), s('\\vec{v}', 'v⃗', 'velocity', 'speed'), s('\\vec{s}', 's⃗', 'displacement'),
      s('\\Delta x', 'Δx', 'change in position', 'displacement'), s('\\vec{p}', 'p⃗', 'momentum'), s('\\vec{L}', 'L⃗', 'angular momentum'), s('\\vec{\\tau}', 'τ⃗', 'torque'), s('\\omega', 'ω', 'angular velocity'),
      s('\\alpha', 'α', 'angular acceleration'), s('\\mu_k', 'μₖ', 'kinetic friction'), s('\\mu_s', 'μₛ', 'static friction'), s('I', 'I', 'moment of inertia'),
    ],
  },
  {
    id: 'energy', label: 'Energy & work',
    symbols: [
      s('E', 'E', 'energy', 'joule'), s('E_k', 'Eₖ', 'kinetic energy'), s('E_p', 'Eₚ', 'potential energy'), s('W', 'W', 'work'), s('P', 'P', 'power', 'watt'), s('\\eta', 'η', 'efficiency'), s('Q', 'Q', 'heat'),
    ],
  },
  {
    id: 'fields', label: 'Gravity & fields',
    symbols: [
      s('g', 'g', 'gravitational acceleration'), s('\\vec{g}', 'g⃗', 'gravitational field'), s('\\vec{E}', 'E⃗', 'electric field'), s('\\vec{B}', 'B⃗', 'magnetic field'), s('\\vec{D}', 'D⃗', 'electric displacement'), s('\\vec{H}', 'H⃗', 'magnetic intensity'),
      s('\\Phi_B', 'Φ_B', 'magnetic flux'), s('\\Phi_E', 'Φ_E', 'electric flux'), s('\\vec{J}', 'J⃗', 'current density'), s('\\rho', 'ρ', 'charge density'),
      s('\\nabla\\cdot\\vec{E}', '∇·E', 'divergence of E', 'gauss maxwell'), s('\\nabla\\times\\vec{B}', '∇×B', 'curl of B', 'ampere maxwell'),
    ],
  },
  {
    id: 'waves', label: 'Waves',
    symbols: [
      s('\\lambda', 'λ', 'wavelength'), s('f', 'f', 'frequency', 'hertz'), s('\\nu', 'ν', 'frequency (nu)'), s('\\omega', 'ω', 'angular frequency'), s('T', 'T', 'period'), s('k', 'k', 'wave number'), s('A', 'A', 'amplitude'), s('\\phi', 'ϕ', 'phase'),
    ],
  },
  {
    id: 'thermo', label: 'Thermal & fluids',
    symbols: [
      s('T', 'T', 'temperature', 'kelvin'), s('p', 'p', 'pressure', 'pascal'), s('\\rho', 'ρ', 'density'), s('V', 'V', 'volume'), s('n', 'n', 'amount of substance', 'moles'), s('\\Delta T', 'ΔT', 'temperature change'), s('S', 'S', 'entropy'), s('U', 'U', 'internal energy'),
    ],
  },
  {
    id: 'constants', label: 'Constants',
    symbols: [
      s('c', 'c', 'speed of light'), s('G', 'G', 'gravitational constant'), s('h', 'h', 'Planck constant'), s('\\hbar', 'ħ', 'reduced Planck constant'), s('k_B', 'k_B', 'Boltzmann constant'), s('e', 'e', 'elementary charge'), s('m_e', 'mₑ', 'electron mass'), s('m_p', 'mₚ', 'proton mass'),
      s('N_A', 'N_A', 'Avogadro constant'), s('R', 'R', 'gas constant'), s('\\varepsilon_0', 'ε₀', 'vacuum permittivity'), s('\\mu_0', 'μ₀', 'vacuum permeability'), s('\\sigma', 'σ', 'Stefan-Boltzmann constant'),
    ],
  },
  {
    id: 'units', label: 'Units',
    symbols: [
      s('\\,\\mathrm{m}', 'm', 'metre'), s('\\,\\mathrm{kg}', 'kg', 'kilogram'), s('\\,\\mathrm{s}', 's', 'second'), s('\\,\\mathrm{N}', 'N', 'newton'), s('\\,\\mathrm{J}', 'J', 'joule'), s('\\,\\mathrm{W}', 'W', 'watt'), s('\\,\\mathrm{Pa}', 'Pa', 'pascal'), s('\\,\\mathrm{Hz}', 'Hz', 'hertz'),
      s('\\,\\mathrm{V}', 'V', 'volt'), s('\\,\\mathrm{A}', 'A', 'ampere'), s('\\,\\Omega', 'Ω', 'ohm'), s('\\,\\mathrm{F}', 'F', 'farad'), s('\\,\\mathrm{H}', 'H', 'henry'), s('\\,\\mathrm{T}', 'T', 'tesla'), s('\\,\\mathrm{K}', 'K', 'kelvin'), s('\\,\\mathrm{mol}', 'mol', 'mole'),
    ],
  },
  {
    id: 'laws', label: 'Common equations',
    symbols: [
      s('\\vec{F}=m\\vec{a}', 'F=ma', 'Newton second law'), s('E=mc^2', 'E=mc²', 'mass energy'), s('V=IR', 'V=IR', 'Ohm law'), s('PV=nRT', 'PV=nRT', 'ideal gas law'), s('E_k=\\frac{1}{2}mv^2', '½mv²', 'kinetic energy formula'),
      s('F=G\\frac{m_1 m_2}{r^2}', 'Gm₁m₂/r²', 'Newton gravitation'), s('v=f\\lambda', 'v=fλ', 'wave equation'), s('E=h\\nu', 'E=hν', 'photon energy'),
    ],
  },
];

export const CHEMISTRY_TOKENS: SymbolCategory[] = [
  {
    id: 'operators', label: 'Operators',
    symbols: [s(' + ', '+', 'plus'), s(' - ', '−', 'minus'), s(' . ', '·', 'hydrate dot', 'water of crystallisation'), s(' v ', '↓', 'precipitate', 'down arrow solid'), s(' ^ ', '↑', 'gas evolved', 'up arrow')],
  },
  {
    id: 'arrows', label: 'Reaction arrows',
    symbols: [
      s(' -> ', '→', 'forward'), s(' <- ', '←', 'backward'), s(' <-> ', '↔', 'resonance'), s(' <=> ', '⇌', 'equilibrium'), s(' <=>> ', '⇀↽', 'equilibrium, right favoured'), s(' <<=> ', '↼⇁', 'equilibrium, left favoured'),
      s(' ->[$\\Delta$] ', '→Δ', 'heat above arrow', 'temperature'), s(' ->[Pt][$\\Delta$] ', '→cat', 'catalyst and heat', 'conditions'),
    ],
  },
  {
    id: 'states', label: 'States',
    symbols: [s('(s)', '(s)', 'solid'), s('(l)', '(l)', 'liquid'), s('(g)', '(g)', 'gas'), s('(aq)', '(aq)', 'aqueous')],
  },
  {
    id: 'notation', label: 'Notation',
    symbols: [s('^{2+}', '²⁺', 'ion charge 2+'), s('^{3+}', '³⁺', 'ion charge 3+'), s('^{+}', '⁺', 'cation'), s('^{-}', '⁻', 'anion'), s('^{2-}', '²⁻', 'ion charge 2−'), s('^{14}_{6}C', '¹⁴₆C', 'isotope', 'nuclide carbon')],
  },
  {
    id: 'compounds', label: 'Common species',
    symbols: ['H2O', 'CO2', 'H2SO4', 'Ca(OH)2', 'NH4+', 'SO4^2-', 'Fe^3+', 'NaCl', 'HCl', 'NaOH', 'O2', 'H2', 'N2', 'CH4', 'NH3', 'CaCO3', 'HNO3', 'KMnO4'].map((f) => s(f, f.replace(/\^/g, ''), f, 'compound ion formula')),
  },
];

export function searchSymbols(categories: SymbolCategory[], query: string): SymbolDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: SymbolDef[] = [];
  for (const c of categories) {
    for (const sym of c.symbols) {
      if (seen.has(sym.tex)) continue;
      if (sym.name.toLowerCase().includes(q) || sym.keywords?.toLowerCase().includes(q) || sym.tex.toLowerCase().includes(q) || sym.glyph === query.trim() || c.label.toLowerCase().includes(q)) {
        seen.add(sym.tex);
        out.push(sym);
      }
    }
  }
  return out;
}
