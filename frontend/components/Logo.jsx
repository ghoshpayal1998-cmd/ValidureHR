/*
 * Two <img> rather than one re-coloured file: the master logo is an
 * auto-traced 18-step gradient, so there is no single fill to swap and a
 * CSS filter would muddy the teal. CSS shows whichever variant suits the
 * active theme (see .brandmark in globals.css).
 */
export default function Logo({ size = 28, wordmark = true, className = '' }) {
  return (
    <span className={`brandlock ${className}`}>
      <img
        className="brandmark brandmark--light"
        src="/brand/validure-mark.svg"
        alt=""
        width={size}
        height={size}
      />
      <img
        className="brandmark brandmark--dark"
        src="/brand/validure-mark-dark.svg"
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
