// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticleButton } from "@/components/ui/particle-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ParticleButton", () => {
  it("runs one allowed action and emits the installed six-particle burst", () => {
    let locked = false;
    const onClick = vi.fn(() => {
      locked = true;
    });

    render(
      <ParticleButton
        canTrigger={() => !locked}
        onClick={onClick}
        particleClassName="bg-gold"
      >
        إنشاء الصورة
      </ParticleButton>,
    );

    const button = screen.getByRole("button", { name: "إنشاء الصورة" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-particle="true"]')).toHaveLength(6);
    expect(button.className).toContain("scale-95");
  });

  it("does not animate or invoke the action while disabled or invalid", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ParticleButton disabled onClick={onClick}>
        إنشاء الصورة
      </ParticleButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "إنشاء الصورة" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-particle="true"]')).toBeNull();

    rerender(
      <ParticleButton canTrigger={() => false} onClick={onClick}>
        إنشاء الصورة
      </ParticleButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الصورة" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-particle="true"]')).toBeNull();
  });
});
