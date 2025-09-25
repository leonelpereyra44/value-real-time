# Estructura CSS Modularizada

Este proyecto utiliza una arquitectura CSS modular para mejor organización y mantenibilidad.

## 📁 Estructura de Archivos

```
css/
├── styles.css       # Archivo principal (importa todos los módulos)
├── base.css         # Reset, variables CSS y tipografía base
├── layout.css       # Layouts, containers y estructura del grid
├── components.css   # Botones, estados y elementos interactivos
└── responsive.css   # Media queries y diseño adaptativo
```

## 🎯 Descripción de Módulos

### 1. `base.css`
- **Propósito**: Fundamentos del diseño
- **Contenido**:
  - Reset CSS universal (`* { margin: 0; padding: 0; }`)
  - Variables CSS personalizadas (`:root`)
  - Estilos base del body
  - Tipografía fundamental (h1, h2, etc.)

### 2. `layout.css`
- **Propósito**: Estructura y layouts
- **Contenido**:
  - Container principal
  - Price display section
  - Info grid layout
  - Chart container
  - Estructura de canvas

### 3. `components.css`
- **Propósito**: Elementos interactivos y estados
- **Contenido**:
  - Estados de precio (positive/negative)
  - Botones del gráfico
  - Estados de carga y actualización
  - Mensajes de error/éxito/warning
  - Indicadores de estado de datos
  - Animaciones y transiciones

### 4. `responsive.css`
- **Propósito**: Diseño adaptativo
- **Contenido**:
  - Media queries para tablets (768px)
  - Media queries para móviles (480px)
  - Media queries para pantallas pequeñas (320px)
  - Orientación landscape
  - Pantallas grandes (1200px+)
  - Dark mode support

## 🎨 Variables CSS Disponibles

```css
:root {
    --primary-color: #2196F3;
    --success-color: #4CAF50;
    --danger-color: #f44336;
    --warning-color: #ff9800;
    --background-white: rgba(255, 255, 255, 0.95);
    --shadow-light: 0 20px 40px rgba(0, 0, 0, 0.1);
    --shadow-medium: 0 4px 6px rgba(0, 0, 0, 0.1);
    --border-radius: 20px;
    --border-radius-small: 10px;
    --border-radius-mobile: 15px;
}
```

## 📱 Breakpoints Responsive

- **Desktop**: > 1200px
- **Tablet**: ≤ 768px
- **Mobile**: ≤ 480px
- **Small Mobile**: ≤ 320px
- **Landscape Mobile**: ≤ 768px + landscape orientation

## 🔄 Cómo Usar

### Importación Principal
```html
<link rel="stylesheet" href="css/styles.css">
```

### Modificar un Módulo Específico
1. Edita el archivo del módulo correspondiente
2. Los cambios se reflejarán automáticamente via `@import`

### Agregar Nuevos Módulos
1. Crea el archivo CSS en `/css/`
2. Añade `@import url('./nuevo-modulo.css');` en `styles.css`

## 🎯 Ventajas de esta Estructura

- ✅ **Mantenibilidad**: Cada módulo tiene responsabilidades específicas
- ✅ **Escalabilidad**: Fácil añadir nuevos componentes
- ✅ **Reutilización**: Variables CSS centralizadas
- ✅ **Performance**: Carga optimizada con imports
- ✅ **Colaboración**: Múltiples desarrolladores pueden trabajar en paralelo
- ✅ **Debug**: Fácil localizar y corregir estilos específicos

## 🛠️ Guías de Contribución

### Añadir un Nuevo Componente
1. Evalúa si pertenece a un módulo existente
2. Si es nuevo, crea archivo en `/css/`
3. Usa las variables CSS definidas en `base.css`
4. Sigue el patrón de nomenclatura BEM cuando sea apropiado

### Modificar Responsive Design
- Todos los media queries van en `responsive.css`
- Mantén consistencia en los breakpoints definidos
- Testa en múltiples dispositivos

### Variables CSS
- Centraliza colores y medidas en `base.css`
- Usa nombres semánticos (--primary-color, no --blue)
- Documenta nuevas variables en este README