/** Completion certificate (PDF). Only called after the course's completion requirements are met. */
export interface CertificateInfo {
  student: string
  course: string
  completed: Date
  organization: string
  instructor: string
}

export async function certificatePdf(c: CertificateInfo): Promise<Blob> {
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vfs: any = (vfsMod as any).default ?? vfsMod
  pdfMake.addVirtualFileSystem(vfs)
  const date = c.completed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const signers = [c.instructor && { text: [{ text: c.instructor, bold: true }, '\nInstructor'], alignment: 'center' }, c.organization && { text: [{ text: c.organization, bold: true }, '\nIssued by'], alignment: 'center' }].filter(Boolean)
  const def = {
    pageOrientation: 'landscape',
    pageMargins: [60, 60, 60, 60],
    background: (_: number, size: { width: number; height: number }) => ({
      canvas: [
        { type: 'rect', x: 24, y: 24, w: size.width - 48, h: size.height - 48, lineWidth: 3, lineColor: '#1F5F7A' },
        { type: 'rect', x: 32, y: 32, w: size.width - 64, h: size.height - 64, lineWidth: 0.75, lineColor: '#1F5F7A' },
      ],
    }),
    content: [
      { text: 'CERTIFICATE OF COMPLETION', alignment: 'center', fontSize: 14, characterSpacing: 3, color: '#1F5F7A', margin: [0, 40, 0, 24] },
      { text: 'This certifies that', alignment: 'center', fontSize: 13 },
      { text: c.student, alignment: 'center', fontSize: 30, bold: true, margin: [0, 10, 0, 10] },
      { text: 'has completed the course', alignment: 'center', fontSize: 13 },
      { text: c.course, alignment: 'center', fontSize: 22, bold: true, margin: [0, 8, 0, 8] },
      { text: `on ${date}`, alignment: 'center', fontSize: 13, margin: [0, 0, 0, 40] },
      signers.length ? { columns: signers, columnGap: 40 } : '',
      { text: '"Study to shew thyself approved unto God." 2 Timothy 2:15 (KJV)', alignment: 'center', fontSize: 10, italics: true, color: '#5B6168', margin: [0, 36, 0, 0] },
    ],
    defaultStyle: { font: 'Roboto' },
  }
  return pdfMake.createPdf(def).getBlob()
}
