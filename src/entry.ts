// The street is home. Circuit links opt in explicitly, independent of saved races.
const query = new URLSearchParams(location.search);
if (['shanghai', 'nordschleife'].includes(query.get('track') ?? '')) {
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&family=Noto+Sans+SC:wght@400;500;700&display=swap';
  document.head.append(fonts);
  void import('./main');
} else {
  location.replace(`${import.meta.env.BASE_URL}openracing/${location.search}${location.hash}`);
}
