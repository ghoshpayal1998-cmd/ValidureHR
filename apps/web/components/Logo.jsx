/*
 * One file, both themes.
 *
 * There used to be a light and a dark variant here. There should not be: the
 * emblem is the supplied artwork, and it reads on the dark surface unchanged —
 * the silver rim separates every form, so the navy behaves as depth rather
 * than vanishing into the background. Recolouring a logo to suit a background
 * is not a dark mode, it is a different logo.
 *
 * The wordmark beside it is HTML text, so it themes itself.
 */
export default function Logo({ size = 28, wordmark = true, className = '' }) {
  return (
    <span className={`brandlock ${className}`}>
      <img
        className="brandmark"
        src="/brand/validure-mark.svg"
        alt=""
        width={size}
        height={size}
      />
      {wordmark && (
        <span className="brandword" style={{ fontSize: size > 30 ? '1.1rem' : '.95rem' }}>
          VALIDURE<em>HR</em>
        </span>
      )}
    </span>
  );
}
