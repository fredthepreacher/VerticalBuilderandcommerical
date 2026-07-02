const ITEMS: [string, string][] = [
  ['shield', 'Licensed & Insured'],
  ['home', 'General Contractor + Roofing Contractor'],
  ['clock', 'Free Estimates & Inspections'],
  ['pin', 'Southwest Florida Service Area'],
  ['dollar', 'Financing Options Available'],
]

const ICONS: Record<string, React.ReactNode> = {
  shield: <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />,
  home: <path d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  pin: <><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  dollar: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
}

export default function TrustBar() {
  return (
    <div className="trustbar">
      <div className="container">
        {ITEMS.map(([icon, label]) => (
          <div className="trust-item" key={icon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0492c" strokeWidth="2.4">{ICONS[icon]}</svg>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
