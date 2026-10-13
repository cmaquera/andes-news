import 'package:flutter/material.dart';

const ink = Color(0xff13181b),
    blue = Color(0xff08a9ee),
    muted = Color(0xff7a858d),
    pale = Color(0xfff0faff);
// Retained for callers of the first version's theme.
const green = blue;
ThemeData andesTheme() => ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: blue, primary: blue),
  scaffoldBackgroundColor: Colors.white,
  fontFamily: 'sans-serif',
  textTheme: const TextTheme(
    headlineLarge: TextStyle(
      color: ink,
      fontWeight: FontWeight.w700,
      fontSize: 28,
    ),
    titleLarge: TextStyle(
      color: ink,
      fontWeight: FontWeight.w700,
      fontSize: 21,
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.white,
    foregroundColor: ink,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
  ),
  dividerColor: const Color(0xffedf0f2),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: pale,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide.none,
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: blue,
      foregroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
    ),
  ),
  navigationBarTheme: const NavigationBarThemeData(
    backgroundColor: Colors.white,
    indicatorColor: pale,
    surfaceTintColor: Colors.transparent,
  ),
  cardTheme: CardThemeData(
    elevation: 0,
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: const BorderSide(color: Color(0xffedf0f2)),
    ),
  ),
);
