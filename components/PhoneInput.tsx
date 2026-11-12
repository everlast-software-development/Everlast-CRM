"use client";

import { forwardRef, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// One phone field for the whole app: a country-code box (UAE by default) and
// the number, checked for that country with libphonenumber. Pasting a full
// international number (+20…, 00971…) picks its country by itself.
// onChange gets the number as +E.164 ("+971501234567") — or "" while it isn't
// a valid number yet — and whether it is valid.

// The countries patients most often have, first; then every other, by name.
const FIRST: CountryCode[] = ["AE", "SA", "EG", "KW", "QA", "BH", "OM", "JO", "LB", "IQ", "SY", "PS", "SD", "MA", "GB", "US", "IN", "PK", "PH", "RU"];

let regionNames: Intl.DisplayNames | null = null;
const countryName = (c: CountryCode) => {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(c) || c;
  } catch {
    return c;
  }
};

export interface PhoneValue {
  /** +E.164 when valid, else "". */
  e164: string;
  valid: boolean;
  /** What's typed, for "required" checks. */
  raw: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, {
  id?: string;
  defaultCountry?: CountryCode;
  autoFocus?: boolean;
  /** Show the "will be saved as" / "not valid" line under the field. */
  showHint?: boolean;
  invalid?: boolean;
  onChange: (v: PhoneValue) => void;
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
}>(function PhoneInput({ id, defaultCountry = "AE", autoFocus, showHint = true, invalid, onChange, onEnter, placeholder, className = "" }, ref) {
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [text, setText] = useState("");

  const options = useMemo(() => {
    const all = getCountries();
    const rest = all.filter((c) => !FIRST.includes(c)).sort((a, b) => countryName(a).localeCompare(countryName(b)));
    return [...FIRST.filter((c) => all.includes(c)), ...rest];
  }, []);

  const parsed = text.trim() ? parsePhoneNumberFromString(text, country) : undefined;
  const valid = Boolean(parsed?.isValid());

  function emit(t: string, c: CountryCode) {
    const p = t.trim() ? parsePhoneNumberFromString(t, c) : undefined;
    const ok = Boolean(p?.isValid());
    onChange({ e164: ok && p ? p.number : "", valid: ok, raw: t });
  }

  function type(t: string) {
    // A full international number pasted or typed: take its country, keep the rest.
    const intl = t.trim().startsWith("+") || t.trim().startsWith("00") ? parsePhoneNumberFromString(t.trim().replace(/^00/, "+")) : undefined;
    if (intl?.country) {
      setCountry(intl.country);
      setText(intl.formatNational());
      emit(intl.formatNational(), intl.country);
      return;
    }
    setText(t);
    emit(t, country);
  }

  function pick(c: CountryCode) {
    setCountry(c);
    emit(text, c);
  }

  const border = invalid || (text.trim() && !valid && showHint) ? "border-red-300 focus-within:ring-red-200" : "border-gray-200 focus-within:border-brand focus-within:ring-brand/15";

  return (
    <div className={className}>
      <div className={`flex items-stretch rounded-xl border bg-white focus-within:ring-2 transition-colors ${border}`} dir="ltr">
        {/* The country box: what shows is "AE +971"; the real select sits invisibly on top. */}
        <label className="relative flex items-center gap-1 pl-3 pr-2 border-r border-gray-200 text-[13.5px] text-gray-700 shrink-0 cursor-pointer hover:bg-gray-50 rounded-l-xl">
          <span className="text-[11px] font-semibold text-gray-400">{country}</span>
          <span className="font-medium tabular-nums">+{getCountryCallingCode(country)}</span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => pick(e.target.value as CountryCode)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          >
            {options.map((c) => (
              <option key={c} value={c}>
                +{getCountryCallingCode(c)} · {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => type(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          placeholder={placeholder ?? (country === "AE" ? "50 123 4567" : "Phone number")}
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-[14px] text-gray-800 placeholder:text-gray-400 outline-none rounded-r-xl"
        />
      </div>
      {showHint && text.trim() && (
        <p className={`text-[12px] mt-1 ${valid ? "text-green-600" : "text-amber-600"}`}>
          {valid && parsed ? <>✓ Will be saved as <span className="font-mono font-semibold">{parsed.formatInternational()}</span></> : `Not a valid ${countryName(country)} number yet`}
        </p>
      )}
    </div>
  );
});
