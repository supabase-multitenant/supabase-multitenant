import { Navigate } from 'react-router-dom'
import { FIRST_PAGE_SLUG } from '../lib/docs'

export function DocsRedirect() {
  return <Navigate to={`/docs/${FIRST_PAGE_SLUG}`} replace />
}
