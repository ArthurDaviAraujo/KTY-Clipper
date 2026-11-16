import { Hourglass } from 'lucide-react'
import { Badge, Card } from '../ui'

export default function SoonPage({ title, phase, text }: { title: string; phase: number; text: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 pt-6">
      <h2 className="text-2xl font-bold">{title}</h2>
      <Card className="flex items-start gap-4 p-6">
        <Hourglass className="mt-1 shrink-0 text-gold" />
        <div className="space-y-2">
          <Badge tone="accent">Chega na fase {phase}</Badge>
          <p className="text-sm text-muted">{text}</p>
        </div>
      </Card>
    </div>
  )
}
