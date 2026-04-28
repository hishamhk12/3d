"use client";

export function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          .company-logo-container {
            overflow: visible;
          }
          
          /* Base state for all parts */
          .company-logo-mark,
          .company-logo-text > * {
            opacity: 0;
            will-change: transform, opacity;
            transform-origin: center;
          }

          /* Initial load animations */
          .company-logo-text > * {
            animation: staggered-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }

          .company-logo-mark {
            animation: 
              staggered-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards,
              logo-shimmer 4s ease-in-out 1.2s infinite alternate;
          }

          /* Hover state animations (Re-triggering the same effect) */
          .company-logo-container:hover .company-logo-text > * {
            animation: staggered-fade-up-hover 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }
          
          .company-logo-container:hover .company-logo-mark {
            animation: 
              staggered-fade-up-hover 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards,
              logo-shimmer 4s ease-in-out 1.2s infinite alternate;
          }

          /* Keyframes */
          @keyframes staggered-fade-up {
            0% { opacity: 0; transform: translateY(8px) scale(0.96); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }
          
          @keyframes staggered-fade-up-hover {
            0% { opacity: 0; transform: translateY(8px) scale(0.96); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }

          @keyframes logo-shimmer {
            0% { filter: drop-shadow(0 0 0px rgba(0, 173, 215, 0)); }
            100% { filter: drop-shadow(0 0 8px rgba(0, 173, 215, 0.4)) brightness(1.1); }
          }

          /* Staggered delays for the text letters */
          .company-logo-text > *:nth-child(1) { animation-delay: 0.10s; }
          .company-logo-text > *:nth-child(2) { animation-delay: 0.14s; }
          .company-logo-text > *:nth-child(3) { animation-delay: 0.18s; }
          .company-logo-text > *:nth-child(4) { animation-delay: 0.22s; }
          .company-logo-text > *:nth-child(5) { animation-delay: 0.26s; }
          .company-logo-text > *:nth-child(6) { animation-delay: 0.30s; }
          .company-logo-text > *:nth-child(7) { animation-delay: 0.34s; }
          .company-logo-text > *:nth-child(8) { animation-delay: 0.38s; }
          .company-logo-text > *:nth-child(9) { animation-delay: 0.42s; }
          .company-logo-text > *:nth-child(10) { animation-delay: 0.46s; }
          .company-logo-text > *:nth-child(11) { animation-delay: 0.50s; }
          .company-logo-text > *:nth-child(12) { animation-delay: 0.54s; }
          .company-logo-text > *:nth-child(13) { animation-delay: 0.58s; }
          .company-logo-text > *:nth-child(14) { animation-delay: 0.62s; }
          .company-logo-text > *:nth-child(15) { animation-delay: 0.66s; }
          .company-logo-text > *:nth-child(16) { animation-delay: 0.70s; }
          .company-logo-text > *:nth-child(17) { animation-delay: 0.74s; }
          .company-logo-text > *:nth-child(18) { animation-delay: 0.78s; }
          .company-logo-text > *:nth-child(19) { animation-delay: 0.82s; }
          .company-logo-text > *:nth-child(20) { animation-delay: 0.86s; }
          .company-logo-text > *:nth-child(21) { animation-delay: 0.90s; }
          .company-logo-text > *:nth-child(22) { animation-delay: 0.94s; }
          .company-logo-text > *:nth-child(23) { animation-delay: 0.98s; }
          .company-logo-text > *:nth-child(24) { animation-delay: 1.02s; }

          @media (prefers-reduced-motion: reduce) {
            .company-logo-mark,
            .company-logo-text > * {
              animation: none !important;
              opacity: 1;
              transform: none !important;
            }
          }
        `
      }} />
      <svg
        className={`company-logo-container ${className}`.trim()}
        id="Layer_1"
        data-name="Layer 1"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 260.49 86.59"
      >
      {/* 
        The blue icon path (شعار الشركة المائي) 
      */}
      <path
        className="company-logo-mark"
        fill="#00add7"
        d="M0,0v80.69h69.16v-28.97c0-3.1-2.51-5.61-5.61-5.61H23.05v11.53h34.58v11.53H11.53V11.53h46.11v11.53H23.05v11.53h40.54c3.08,0,5.57-2.49,5.57-5.57V0H0"
      />

      {/* 
        The white text paths.
      */}
      <g className="company-logo-text" fill="currentColor">
        {/* We use currentColor so it adapts to the UI theme if needed, but it works correctly for white/navy */}
        <path d="M101.13,67.77v-.31c2.65-.82,2.65-2.65,2.65-3.18v-3.58c0-3.34-2.58-4.7-5.21-4.7h-9.95v24.64h11.19c2.41,0,4.84-1.57,4.84-4.55v-4.22c0-3.89-3.53-4.09-3.53-4.09M93.25,59.84h4.17c.99,0,1.79.7,1.79,1.56v2.98c0,1.32-1.15,1.66-1.77,1.66h-4.19v-6.2ZM100.11,75.1c0,1.32-1.15,1.66-1.77,1.66h-5.08v-6.84h5.06c.99,0,1.79.7,1.79,1.56v3.62Z"/>
        <path d="M117.21,62.68h-8.21v3.75h7.07c.24,0,1.17.24,1.17,1.17v1.9h-4.92c-2.95,0-4.7,2.14-4.7,4.02v3.09c0,2.56,2.1,4.31,4.46,4.31h2.09s2.05.29,3.66-2.07h.34l.41,1.78h3.07v-13.94c0-2.27-2.17-4.02-4.43-4.02M117.23,75.36c0,.94-.93,1.84-1.69,1.84h-2.19c-1.1,0-1.43-1.13-1.43-1.41v-1.29c0-.71.84-1.29,1.5-1.29h3.81v2.14Z"/>
        <path d="M238.07,62.68h-8.21v3.75h7.07c.24,0,1.17.24,1.17,1.17v1.9h-4.92c-2.95,0-4.7,2.14-4.7,4.02v3.09c0,2.56,2.1,4.31,4.46,4.31h2.1s2.05.29,3.65-2.07h.34l.41,1.78h3.07v-13.94c0-2.27-2.17-4.02-4.43-4.02M238.09,75.36c0,.94-.93,1.84-1.69,1.84h-2.19c-1.1,0-1.42-1.13-1.42-1.41v-1.29c0-.71.84-1.29,1.5-1.29h3.81v2.14Z"/>
        <path d="M256.05,62.68h-8.21v3.75h7.07c.24,0,1.17.24,1.17,1.17v1.9h-4.92c-2.95,0-4.7,2.14-4.7,4.02v3.09c0,2.56,2.1,4.31,4.46,4.31h2.1s2.05.29,3.66-2.07h.34l.41,1.78h3.07v-13.94c0-2.27-2.17-4.02-4.44-4.02M256.08,75.36c0,.94-.93,1.84-1.69,1.84h-2.19c-1.1,0-1.43-1.13-1.43-1.41v-1.29c0-.71.84-1.29,1.5-1.29h3.81v2.14Z"/>
        <path d="M124.58,62.68h4.57l3,12.04h.34l2.27-12.04h4.53v1.8l-4.41,16.23c-.83,2.58-2.73,5.87-6.14,5.87h-2.61v-3.75h1.44c.54,0,1.56-.46,2.27-2.46l-5.25-15.86v-1.83"/>
        <path d="M144.96,57.59l-1.76,5.09h-2.1v3.75h2.05v10.04c0,1.53,1.46,4.17,4.73,4.17h4.09v-3.75h-3c-.76,0-1.41-.56-1.41-1.58v-8.89h3.51v-3.73h-3.46v-5.09h-2.66"/>
        <path d="M173.73,56h-5.94l-6.14,22.42v2.22h4.56l1.27-5.31h6.57l1.27,5.31h4.56v-2.22l-6.14-22.42M168.28,71.45l2.29-9.28h.38l2.29,9.28h-4.96Z"/>
        <path d="M183.45,76.46v-20.46h4.39v19.69c0,.22.32,1.21,1.29,1.21h.93v3.7h-2.24c-2.27,0-4.39-1.81-4.37-4.14"/>
        <path d="M206.91,73.46v-6.82c0-3.49-3.42-4.37-4.37-4.37h-4.57c-1.06,0-4.93.51-4.93,4.64v9.52c0,1.41,1.02,4.17,4.82,4.17h8.42v-3.73h-7.35c-.93,0-1.5-.66-1.5-1.33v-2.08h9.47M197.45,67.33c0-.37.38-1.33,1.35-1.33h2.33c.97,0,1.35.97,1.35,1.33v2.39h-5.03v-2.39Z"/>
        <path d="M220.59,62.68h-5.29v-6.68h-4.41v24.6h9.32c3.38,0,4.91-2.23,4.91-4.62v-9.07c0-2.41-2.22-4.24-4.53-4.24M220.67,75.4c0,1.24-.85,1.46-1.56,1.46h-3.83v-10.45h3.83c.71,0,1.56.22,1.56,1.46v7.53Z"/>
        <path d="M240.8,37.63h-4c-.1,0-.19.08-.19.19v4.12c0,.1.08.18.19.18h4c.1,0,.18-.08.18-.18v-4.12c0-.1-.08-.19-.18-.19"/>
        <path d="M246.45,37.63h-4c-.1,0-.19.08-.19.19v4.12c0,.1.08.18.19.18h4c.1,0,.18-.08.18-.18v-4.12c0-.1-.08-.19-.18-.19"/>
        <path d="M259.56,37.63h-4.28c-.1,0-.19.08-.19.19v4.12c0,.1.08.18.19.18h4.28c.1,0,.19-.08.19-.18v-4.12c0-.1-.08-.19-.19-.19"/>
        <path d="M255.65,17.06v11.35c0,.74-.14,1.26-.41,1.53-.27.27-.72.41-1.34.41h-3.75c-.96,0-1.74-.2-2.3-.6-.56-.39-.83-.95-.83-1.69v-11h-4.69v9.58c0,.69-.01,1.29-.04,1.78-.02.47-.1.85-.21,1.13-.11.27-.27.47-.49.6-.23.13-.57.2-1.01.2h-4.34c-.94,0-1.69-.19-2.24-.57-.55-.37-.83-.9-.88-1.61v-11.11h-4.69v10.01c0,.62-.02,1.16-.06,1.6-.04.42-.12.76-.24,1.01-.12.24-.28.4-.51.51-.23.11-.56.16-.98.16h-19.03c-.61,0-1.07-.14-1.34-.41-.27-.27-.41-.79-.41-1.54v-8.07h-4.69v9.09c0,1.74.37,3.05,1.1,3.88.73.84,1.96,1.26,3.65,1.26h21.98c1.25,0,2.25-.16,2.99-.47.67-.28,1.21-.76,1.58-1.41.45.75,1.04,1.25,1.77,1.49.77.26,1.67.39,2.68.39h4.77c1.26,0,2.29-.15,3.04-.45.69-.27,1.23-.75,1.61-1.43.45.75,1.04,1.25,1.76,1.49.77.25,1.68.38,2.72.38h4.81c1.67,0,2.89-.42,3.62-1.25.72-.82,1.09-2.12,1.09-3.85v-12.4h-4.69"/>
        <path d="M90.57,24.5v6.04s-1.95,0-1.95,0v4.03h14.07v-4.03h-6.4c-.16,0-1.03-.19-1.03-1.03v-4.1c0-.84.87-1.03,1.03-1.03h6.4v-4.03h-7.54c-2.48,0-4.57,1.91-4.57,4.16"/>
        <path d="M163.03,38.93v2.68h-.84v2.08h6.24v-2.08h-2.54s-.45-.05-.45-.45v-1.79c0-.4.44-.45.45-.45h2.54v-2.08h-3.1c-1.24,0-2.3.96-2.3,2.09"/>
        <rect x="183.16" y="10.38" width="4.69" height="24.19"/>
        <path d="M147.38,28.41c0,.74-.14,1.26-.41,1.53-.27.27-.72.41-1.34.41h-34.86V10.38h-4.69v24.19h41.28c1.67,0,2.89-.42,3.62-1.25.72-.82,1.09-2.12,1.09-3.85v-12.4h-4.69v11.35"/>
        <path d="M173.6,28.41c0,.74-.14,1.26-.42,1.53s-.73.41-1.35.41h-3.98V14.26h-4.69v16.09h-7.29v4.21h17.7c1.67,0,2.89-.42,3.62-1.25.72-.82,1.09-2.12,1.09-3.85V10.38h-4.69v18.03"/>
        <path d="M212.82,14.54h4c.1,0,.18-.08.18-.19v-4.12c0-.1-.08-.19-.18-.19h-4c-.1,0-.19.08-.19.19v4.12c0,.1.08.19.19.19"/>
        <path d="M218.46,14.54h4c.1,0,.18-.08.18-.19v-4.12c0-.1-.08-.19-.18-.19h-4c-.1,0-.19.08-.19.19v4.12c0,.1.08.19.19.19"/>
        <path d="M151.34,37.63h-4.28c-.1,0-.18.08-.18.19v4.12c0,.1.08.18.18.18h4.28c.1,0,.19-.08.19-.18v-4.12c0-.1-.08-.19-.19-.19"/>
      </g>
    </svg>
    </>
  );
}
