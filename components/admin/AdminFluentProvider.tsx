"use client";

import {
  FluentProvider,
  makeResetStyles,
  webLightTheme,
} from "@fluentui/react-components";

const useAdminResetStyles = makeResetStyles({
  backgroundColor: "#f6f8fb",
  color: "#242424",
  minHeight: "100vh",
});

export default function AdminFluentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const resetClassName = useAdminResetStyles();

  return (
    <FluentProvider
      className={resetClassName}
      dir="ltr"
      theme={webLightTheme}
    >
      {children}
    </FluentProvider>
  );
}
