/** /recover: the only entry to saved access outside a request. No camera or account creation. */
export function Recover({ onOpen }: { onOpen: () => void }) {
  return <div className="public-request-flow">
    <div className="screen-content"><div className="centered-layout">
      <img className="hero-icon" src="/assets/brand/human-badge.svg" alt="" />
      <div className="message-block"><h1>Retrieve your World ID credentials</h1></div>
    </div></div>
    <div className="actions">
      <button className="primary-action" onClick={onOpen}>Go to authenticator</button>
    </div>
  </div>;
}
