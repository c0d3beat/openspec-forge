/**
 * Design-system recommendation rubric (Phase 7).
 *
 * `preview.mjs recommend` scores the allowed React design systems against signals
 * detected in the epic's BRD/PRD, using these weighted criteria. Edit freely —
 * add signals/systems, tune weights. (A JS module, not YAML: richer nested shape,
 * zero-parse, and comment-friendly.)
 */
export const rubric = {
  systems: ['mui', 'ant-design', 'fluent', 'chakra', 'mantine'],
  labels: {
    mui: 'MUI (Material Design)',
    'ant-design': 'Ant Design',
    fluent: 'Fluent UI',
    chakra: 'Chakra UI',
    mantine: 'Mantine',
  },
  packages: {
    mui: '@mui/material',
    'ant-design': 'antd',
    fluent: '@fluentui/react-components',
    chakra: '@chakra-ui/react',
    mantine: '@mantine/core',
  },
  weights: { archetype: 3, brand: 2, complexity: 2, accessibility: 2, i18n: 1, ecosystem: 1 },
  signals: [
    { match: 'dashboard|admin|back-?office|data[- ]?dense|data table|crud|enterprise', criterion: 'archetype', favor: ['ant-design', 'mui'] },
    { match: 'material design|material-ui|google', criterion: 'brand', favor: ['mui'] },
    { match: 'fluent|microsoft|ms[- ]?teams|office ?365|azure|windows', criterion: 'archetype', favor: ['fluent'] },
    { match: 'custom brand|branding|design tokens|theming|white[- ]?label', criterion: 'brand', favor: ['chakra', 'mantine', 'mui'] },
    { match: 'mobile|consumer|responsive', criterion: 'archetype', favor: ['mui'] },
    { match: 'data grid|pivot|complex table|date picker', criterion: 'complexity', favor: ['ant-design', 'mui', 'mantine'] },
    { match: 'accessib|wcag|a11y|screen reader|inclusive', criterion: 'accessibility', favor: ['chakra', 'fluent', 'mui'] },
    { match: 'i18n|internationali|localization|rtl|multi[- ]?locale|multi[- ]?language', criterion: 'i18n', favor: ['ant-design', 'mui', 'fluent'] },
    { match: 'performance|lightweight|bundle size|fast', criterion: 'complexity', favor: ['mantine', 'chakra'] },
  ],
  // Root Provider (theme) per system — used by `preview.mjs mockup` to wrap the single-page app in src/main.jsx.
  providers: {
    mui: { import: "import { ThemeProvider, createTheme } from '@mui/material/styles';\nimport CssBaseline from '@mui/material/CssBaseline';", setup: 'const theme = createTheme();', open: '<ThemeProvider theme={theme}><CssBaseline />', close: '</ThemeProvider>' },
    'ant-design': { import: "import { ConfigProvider } from 'antd';", setup: '', open: '<ConfigProvider>', close: '</ConfigProvider>' },
    fluent: { import: "import { FluentProvider, webLightTheme } from '@fluentui/react-components';", setup: '', open: '<FluentProvider theme={webLightTheme}>', close: '</FluentProvider>' },
    chakra: { import: "import { ChakraProvider } from '@chakra-ui/react';", setup: '', open: '<ChakraProvider>', close: '</ChakraProvider>' },
    mantine: { import: "import { MantineProvider } from '@mantine/core';\nimport '@mantine/core/styles.css';", setup: '', open: '<MantineProvider>', close: '</MantineProvider>' },
  },
};
export default rubric;
