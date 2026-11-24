import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Chart } from '../lib/chart.js';

/** بوم نمودار Chart.js با به‌روزرسانی داده‌ها و دسترسی به نمونه نمودار */
const ChartCanvas = forwardRef(function ChartCanvas(
  { type = 'bar', data, options, className, ariaLabel, onReady },
  ref,
) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const chart = new Chart(canvasRef.current, { type, data, options });
    chartRef.current = chart;
    readyRef.current?.(chart);
    return () => { chart.destroy(); chartRef.current = null; };
    // فقط یک بار برای هر نوع نمودار ساخته می‌شود؛ داده‌ها در افکت بعدی به‌روز می‌شوند
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data = data;
    chart.options = options;
    chart.update();
  }, [data, options]);

  useImperativeHandle(ref, () => ({
    get chart() { return chartRef.current; },
    resize: (...args) => chartRef.current?.resize(...args),
    update: (...args) => chartRef.current?.update(...args),
    toBase64Image: (...args) => chartRef.current?.toBase64Image(...args),
  }), []);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={ariaLabel} />;
});

export default ChartCanvas;
