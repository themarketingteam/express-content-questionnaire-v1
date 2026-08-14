import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

const PRO_FORM_RECOVERY_URL = "https://proform.tmtwebsiteresources.xyz/admin/draft-recovery";

export default function AdminFloatingMenu({ currentPage }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef(null);
  const internalLink = currentPage === "submit-intake"
    ? { label: "Draft Recovery", to: "/admin/draft-recovery" }
    : { label: "Submit Intake (JSON)", to: "/admin/submit-intake" };

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <nav ref={navRef} className="admin-floating-menu" aria-label="Admin page navigation">
      <button
        type="button"
        className={`admin-floating-menu__trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label={`${isOpen ? "Close" : "Open"} admin navigation`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="admin-floating-menu__line" aria-hidden="true" />
        <span className="admin-floating-menu__line" aria-hidden="true" />
        <span className="admin-floating-menu__line" aria-hidden="true" />
      </button>

      <div
        id={menuId}
        className={`admin-floating-menu__links${isOpen ? " is-open" : ""}`}
        aria-hidden={!isOpen}
      >
        <a
          className="admin-floating-menu__link"
          href={PRO_FORM_RECOVERY_URL}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={isOpen ? 0 : -1}
        >
          Pro Form Recovery
        </a>
        <Link
          className="admin-floating-menu__link"
          to={internalLink.to}
          tabIndex={isOpen ? 0 : -1}
          onClick={() => setIsOpen(false)}
        >
          {internalLink.label}
        </Link>
      </div>
    </nav>
  );
}
