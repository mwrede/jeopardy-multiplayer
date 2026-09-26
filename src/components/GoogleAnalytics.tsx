'use client'

import Script from 'next/script'
import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { GA_ID, trackPageView } from '@/lib/analytics'

/**
 * The App Router never reloads the document, so GA's automatic page_view only
 * ever fires once. This re-fires it on every route change.
 */
function PageViews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const qs = searchParams?.toString()
    trackPageView(pathname + (qs ? `?${qs}` : ''))
  }, [pathname, searchParams])

  return null
}

/**
 * Google Analytics 4. Renders nothing at all unless NEXT_PUBLIC_GA_ID is set,
 * so dev and preview builds never pollute the property — and so this sits
 * dormant alongside Vercel Analytics unless you actually want it.
 *
 * Named GoogleAnalytics, not Analytics, because @vercel/analytics exports a
 * component by that name and layout.tsx renders both.
 */
export function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          // Manual page_view only — see PageViews above.
          gtag('config', '${GA_ID}', { send_page_view: false });
        `}
      </Script>
      {/* useSearchParams needs a Suspense boundary to keep the rest static. */}
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
    </>
  )
}
