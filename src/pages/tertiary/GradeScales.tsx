import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { hasCap } from '../../lib/roles'
import type { AppUser, GradeScale } from '../../types'

interface Props { appUser: AppUser }

const DEFAULT_SCALES = [
  { min_score: 70, max_score: 100, grade: 'A', grade_point: 5.0, description: 'Excellent' },
  { min_score: 60, max_score: 69,  grade: 'B', grade_point: 4.0, description: 'Very Good' },
  { min_score: 50, max_score: 59,  grade: 'C', grade_point: 3.0, description: 'Good' },
  { min_score: 45, max_score: 49,  grade: 'D', grade_point: 2.0, description: 'Pass' },
  { min_score: 40, max_score: 44,  grade: 'E', grade_point: 1.0, description: 'Poor' },
  { min_score: 0,  max_score: 39,  grade: 'F', grade_point: 0.0, description: 'Fail' },
]

export default function TertiaryGradeScales({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const [scales, setScales] = useState<GradeScale[]>([])
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    if (!schoolId) return
    supabase.from('grade_scales').select('*').eq('school_id', schoolId).order('min_score', { ascending: false }).then(({ data }) => setScales((data ?? []) as GradeScale[]))
  }, [schoolId])

  async function seedDefaults() {
    setSeeding(true)
    try {
      const rows = DEFAULT_SCALES.map(s => ({ ...s, school_id: schoolId }))
      const { data } = await supabase.from('grade_scales').insert(rows).select()
      setScales((data ?? []) as GradeScale[])
    } finally {
      setSeeding(false)
    }
  }

  async function deleteScale(id: string) {
    await supabase.from('grade_scales').delete().eq('id', id)
    setScales(prev => prev.filter(s => s.id !== id))
  }

  return (
    <>
      <Topbar
        title="Grade Scales"
        meta="Score-to-grade mapping"
        actions={hasCap(appUser, 'structure.manage') ? (
          <div className="flex gap-2">
            {scales.length === 0 && (
              <Button variant="ghost" size="sm" onClick={seedDefaults} disabled={seeding}>
                {seeding ? 'Seeding…' : 'Load WAEC Defaults'}
              </Button>
            )}
            <Button variant="primary" size="sm">+ Add Grade</Button>
          </div>
        ) : undefined}
      />

      <div className="p-8 max-w-xl">
        <Card>
          <CardHeader title="Grade Scale" meta="Applied to all result computations" />
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Grade', 'Score Range', 'Grade Point', 'Description'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500">{h}</th>
                ))}
                <th className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 w-10" />
              </tr>
            </thead>
            <tbody>
              {scales.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-sm text-gray-400 text-center">
                    No grade scale defined.{' '}
                    <button className="text-navy-700 font-semibold hover:underline" onClick={seedDefaults}>
                      Load WAEC defaults
                    </button>
                  </td>
                </tr>
              )}
              {scales.map(s => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-sm text-sm font-bold ${
                      s.grade === 'A' ? 'bg-green-100 text-green-700' :
                      s.grade === 'F' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{s.grade}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-sm text-navy-900">{s.min_score} – {s.max_score}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-navy-900">{Number(s.grade_point).toFixed(1)}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{s.description}</td>
                  <td className="px-5 py-3 text-right">
                    <button className="text-xs text-red-400 hover:text-red-600" onClick={() => deleteScale(s.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
