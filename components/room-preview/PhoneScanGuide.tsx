"use client";

export default function PhoneScanGuide() {
  return (
    <div className="qr-phone-guide" aria-hidden="true">
      <div className="qr-phone-guide__beam" />
      <div className="qr-phone-guide__frame">
        <div className="qr-phone-guide__notch">
          <span />
        </div>
        <div className="qr-phone-guide__glass">
          <div className="qr-phone-guide__scan-area">
            <span className="qr-phone-guide__corner qr-phone-guide__corner--tl" />
            <span className="qr-phone-guide__corner qr-phone-guide__corner--tr" />
            <span className="qr-phone-guide__corner qr-phone-guide__corner--bl" />
            <span className="qr-phone-guide__corner qr-phone-guide__corner--br" />
            <span className="qr-phone-guide__line" />
          </div>
        </div>
      </div>
    </div>
  );
}
