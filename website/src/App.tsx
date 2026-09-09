import { Route, Routes } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { ScrollToTop } from './components/ScrollToTop'
import { Home } from './pages/Home'
import { HowItWorks } from './pages/HowItWorks'
import { DocsRedirect } from './pages/Docs'
import { DocPage } from './pages/DocPage'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-900">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/docs" element={<DocsRedirect />} />
          <Route path="/docs/:slug" element={<DocPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
