interface RunSwitcherProps {
  tickets: string[];
  activeTicket: string;
  onSelect: (ticket: string) => void;
}

export default function RunSwitcher({
  tickets,
  activeTicket,
  onSelect,
}: RunSwitcherProps) {
  if (tickets.length <= 1) return null;

  return (
    <select
      value={activeTicket}
      onChange={(e) => onSelect(e.target.value)}
      className="px-3 py-1.5 rounded-lg text-sm border"
      style={{
        background: "hsl(222 47% 11%)",
        borderColor: "hsl(217 33% 17%)",
        color: "hsl(210 40% 98%)",
      }}
    >
      {tickets.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
